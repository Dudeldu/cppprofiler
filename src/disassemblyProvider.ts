import * as vscode from 'vscode';
import { exec } from 'child_process';

export class DisassemblyProvider implements vscode.TextDocumentContentProvider {
    private program: string | undefined;
    constructor(program?: string) {
        if (program) {
            this.program = program;
        }
    }

    updateExecutable(executable: string) {
        this.program = executable;
    }

    provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        let program = this.program;
        if (!program) { program = vscode.workspace.getConfiguration("cppprofiler").get("executable"); }
        if (!program) {
            const config = vscode.workspace.getConfiguration('launch');
            const launchConfigurations = <any[]>config.get('configurations');
            for (const launchConfiguration of launchConfigurations) {
                if (launchConfiguration.type === "cppdbg" && launchConfiguration.program !== "") {
                    program = launchConfiguration.program;
                    break;
                }
            }
        }

        if (!program) {
            vscode.window.showErrorMessage("No executable found to disassemble");
            return new Promise((resolve, reject) => resolve(""));
        }

        let functionName = uri.path;
        return callObjDump(functionName, program);
    }
}

export async function callObjDump(functionName: string, executable: string): Promise<string> {
    let disassemble = `--disassemble="${functionName}"`;
    if (functionName === "*") { disassemble = "--disassemble"; }
    const config = vscode.workspace.getConfiguration('cppprofiler');
    return new Promise((resolve, reject) => {
        exec(`objdump -d ${executable} ${config.get("objdump.flags")} ${disassemble}`, { cwd: vscode.workspace.rootPath }, (error, content) => {
            if (error) { reject(); }
            content = content.substr(content.indexOf("Disassembly of section .text:"));
            let lines = content.split("\n").map((line) => {
                // reduce the paths to only the file if -l option is set 
                if (line.startsWith("/")) {
                    let fileLine = line.split("/").reverse()[0];
                    return '-----' + fileLine + '-'.repeat(45 - fileLine.length);
                }
                return line;
            });
            content = lines.slice(2).join("\n");
            resolve(content);
        });
    });

}