import * as vscode from 'vscode';
import { ProfilingTaskProvider } from './profilingTask';
import { PerfProfileViewProvider } from './profileView';
import { parsePerfRecord, getPossibleEventsFromFs, FunctionCall } from './profileParser';
import { DisassemblyProvider } from './disassemblyProvider';
import { execSync } from 'child_process';

let profilerTaskProvider: vscode.Disposable;
let disassembleProvider: vscode.Disposable;

let disassembler: DisassemblyProvider;
let profileTreeViewer: PerfProfileViewProvider;
let currentEvent: string | undefined;


export function activate(context: vscode.ExtensionContext) {
	/* 
	- Install perf, objdump, addr2line
	- configure /proc/sys/kernel/perf_event_paranoid < 1
	*/
	ensureRequirements();
	profilerTaskProvider = vscode.tasks.registerTaskProvider("profile", new ProfilingTaskProvider());

	disassembler = new DisassemblyProvider();
	disassembleProvider = vscode.workspace.registerTextDocumentContentProvider("disassemble", disassembler);

	profileTreeViewer = new PerfProfileViewProvider();
	vscode.window.registerTreeDataProvider('perfprofile', profileTreeViewer);

	vscode.commands.registerCommand('cppprofiler.load_profile', () => {
		vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, cancellable: false, title: "Loading perf data" },
			async (progress, token) => {
				let perfData = await parsePerfRecord(currentEvent);
				profileTreeViewer.refresh(perfData);
				if (perfData) { disassembler.updateExecutable(perfData.executable); }
			}
		);
	});
	vscode.window.onDidChangeActiveTextEditor(() => {
		profileTreeViewer.removeDecoration();
	});
	vscode.commands.registerCommand('cppprofiler.show_hotspots', async () => {
		await profileTreeViewer.applyDecoration();
	});
	vscode.commands.registerCommand('cppprofiler.jump_to_cpp_source', async (functionCall : FunctionCall) => {
		let doc = await vscode.workspace.openTextDocument(functionCall.info.src);
		let editor = await vscode.window.showTextDocument(doc);
		let line = functionCall.info.line - 1;
		editor.selections = [new vscode.Selection(line, 0, line, 0)];
        var range = new vscode.Range(line, 0, line, 0);
        editor.revealRange(range);
	});

	vscode.commands.registerCommand('cppprofiler.jump_to_asm_source', async (functionCall : FunctionCall) => {
		let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`disassemble:${functionCall.info.symbol}`));
		if (doc.getText() === "") {
			return;
		}
		await vscode.window.showTextDocument(doc);
	});

	vscode.commands.registerCommand('cppprofiler.switch_event', async () => {
		let event = await vscode.window.showQuickPick(getPossibleEventsFromFs());
		if (event) {
			currentEvent = event;
			profileTreeViewer.removeDecoration();
			vscode.commands.executeCommand('cppprofiler.load_profile');
		}
	});

	vscode.commands.registerCommand('cppprofiler.disassemble', async () => {
		let symbol = await vscode.window.showInputBox({ placeHolder: 'Symbol' });
		if (symbol) {
			profileTreeViewer.removeDecoration();
			let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`disassemble:${symbol}`));
			if (doc.getText() === "") {
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
		}
	});
}

export function deactivate(): void {
	if (profilerTaskProvider) {
		profilerTaskProvider.dispose();
	}
	if (disassembleProvider) {
		disassembleProvider.dispose();
	}
}

function ensureRequirements(): void {
	let version = execSync("objdump --version");
	if (!version.includes("objdump")) { vscode.window.showErrorMessage("Objdump installation not found"); }

	version = execSync("addr2line --version");
	if (!version.includes("addr2line")) { vscode.window.showErrorMessage("Addr2line installation not found"); }

	version = execSync("perf --version");
	if (!version.includes("perf")) { vscode.window.showErrorMessage("Perf installation not found"); }
}