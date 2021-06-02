import * as vscode from "vscode";
import { PerfEventData } from './profileParser';

export function decorate(editor: vscode.TextEditor, perfData: PerfEventData): Promise<undefined | vscode.TextEditorDecorationType> {
    if (editor.document.uri.toString().includes("disassemble")) {
        return decorateAsm(editor, perfData);
    }
    return decorateCpp(editor, perfData);
}

async function decorateCpp(editor: vscode.TextEditor, perfData: PerfEventData): Promise<undefined | vscode.TextEditorDecorationType> {
    let filename = editor.document.fileName.substring(editor.document.fileName.lastIndexOf("/") + 1);
    let linesMap = await perfData.getLinesMap(filename);
    if (linesMap.size === 0) { return; }
    return finalizeDecorationFromLineMap(editor, linesMap, perfData);
}

async function decorateAsm(editor: vscode.TextEditor, perfData: PerfEventData): Promise<undefined | vscode.TextEditorDecorationType> {
    let ipsMaps = await perfData.getIPsMap();
    let linesMap = new Map<number, number>();
    let content = editor.document.getText();
    for (let [index, element] of content.split("\n").entries()) {
        for (let [offset, nrSamples] of ipsMaps) {
            if (element.startsWith("    ") && parseInt(element.substring(0, element.indexOf(":")), 16) === offset) {
                let cur = linesMap.get(index + 1);
                linesMap.set(index + 1, (cur ? cur : 0) + nrSamples);
            }
        }
    }
    return finalizeDecorationFromLineMap(editor, linesMap, perfData);
}

function finalizeDecorationFromLineMap(editor: vscode.TextEditor, linesMap: Map<number, number>, perfData: PerfEventData): vscode.TextEditorDecorationType {
    let decorationsArray: vscode.DecorationOptions[] = [];
    let totalLines = [...linesMap.values()].reduce((x, y) => x + y);
    if (vscode.workspace.getConfiguration('cppprofiler').get('proportionLevel') === "program") {
        // calculate the events in proportion to the total program instead for the open file
        totalLines = perfData.nrEventsInExecutable;
    }
    for (let [line, nrSamples] of linesMap.entries()) {
        if (line > editor.document.lineCount || line <= 0) {
            continue;
        }
        let lineCount = (editor.document.lineCount < 50 ? editor.document.lineCount : 50);
        let linelenght = editor.document.lineAt(line - 1).text.length;
        decorationsArray.push({
            "range": new vscode.Range(line - 1, linelenght, line - 1, linelenght),
            "hoverMessage": `${((nrSamples / totalLines) * 100).toFixed(2)}%`,
            "renderOptions": {
                "after": {
                    contentText: '-'.repeat((linelenght > 80 ? 0 : 80 - linelenght)) + '#'.repeat((nrSamples / totalLines) * lineCount),
                    margin: "1%",
                    color: "gray",
                    fontWeight: '0.5',
                }
            }
        });
    }
    let decoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true, backgroundColor: "#f5e3ce", opacity: "0.9",
        dark: { backgroundColor: "#652626" }, light: { backgroundColor: "#f5e3ce" }
    });
    editor.setDecorations(decoration, decorationsArray);
    return decoration;
}