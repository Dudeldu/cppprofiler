import * as vscode from 'vscode';
import { existsSync, mkdirSync } from 'fs';

export class ProfilingTaskProvider implements vscode.TaskProvider {
	private profilerPromise: vscode.Task[] | undefined = undefined;

	public provideTasks(): vscode.Task[] {
		if (!this.profilerPromise) {
			this.profilerPromise = getProfileTasks();
		}
		return this.profilerPromise;
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		const program = _task.definition.program;
		if (program && _task.definition.type === "profile") {
			const definition: ProfilingTaskDefinition = <any>_task.definition;
			let task = new vscode.Task(definition, vscode.TaskScope.Workspace, definition.program,
				'profile', createPerfRecordCmd(definition));
			task.presentationOptions = { panel: vscode.TaskPanelKind.Dedicated };
			return task;
		}
		return undefined;
	}
}

interface ProfilingTaskDefinition extends vscode.TaskDefinition {
	program: string;
	additionalArguments?: string[];
	setupCmds?: string[];
}

function createPerfRecordCmd(taskDefinition: vscode.TaskDefinition): vscode.ShellExecution {
	const config = vscode.workspace.getConfiguration('cppprofiler');
	if (!existsSync(`${vscode.workspace.rootPath}/${config.get("output")}`)) {
		mkdirSync(`${vscode.workspace.rootPath}/${config.get("output")}`);
	}
	let executionCmd = "";
	if (taskDefinition.setupCmds && taskDefinition.setupCmds.length > 0) {
		executionCmd = taskDefinition.setupCmds.join(" && ") + " && ";
	}
	executionCmd += `perf record -g ${config.get("perf.flags")} -o ${config.get("output")}/perf.data ${taskDefinition.program}`;
	if (taskDefinition.additionalArguments) {
		executionCmd += " " + taskDefinition.additionalArguments.join(" ");
	}
	// For debugging remove `-F -sym,-symoff` to also see the  function symbols and offset also in the perf trace
	executionCmd += ` && perf script -i ${config.get("output")}/perf.data -F -sym,-symoff --per-event-dump --show-mmap-events > ${config.get("output")}/mmap-events.dump`;
	return new vscode.ShellExecution(executionCmd);
}

function getProfileTasks(): vscode.Task[] {
	const tasks: vscode.Task[] = [];
	const config = vscode.workspace.getConfiguration('launch');
	const launchConfigurations = <any[]>config.get('configurations');
	for (const configuration of launchConfigurations) {
		if (configuration.type === "cppdbg") {
			const taskDefinition = {
				type: "profile",
				name: 'CppProfile: ' + configuration.program,
				label: "CppProfile",
				program: configuration.program,
				additionalArguments: configuration.args,
			};
			let task = new vscode.Task(taskDefinition,
				vscode.TaskScope.Workspace, 'CppProfile: ' + configuration.program, 'profile',
				createPerfRecordCmd(taskDefinition));
			task.presentationOptions = { panel: vscode.TaskPanelKind.Dedicated };
			tasks.push(task);
		}
	}
	return tasks;
}