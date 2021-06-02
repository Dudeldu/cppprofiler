import { existsSync, readFileSync, createReadStream, readdirSync } from 'fs';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';

class Addr2LineInfo {
    public src: vscode.Uri;
    public filename: string;
    public line: number;
    public symbol: string;
    public offset: number;

    constructor(srcline: string, symbol: string, offset: number) {
        this.offset = offset;
        this.symbol = symbol;
        let [src, line] = srcline.split(":");
        this.line = parseInt(line);
        this.src = vscode.Uri.parse(path.normalize(src.trim()));
        this.filename = path.basename(src);
    }

    static buildAddr2LineInfos(resp: string, offset: number) : Addr2LineInfo[] {
        let inlineStack = resp.trim().split("\n").reverse();
        let addr2lineInfos : Addr2LineInfo[] = [];
        for(let i = 0; i < inlineStack.length; i+=2){
            addr2lineInfos.push(new Addr2LineInfo(inlineStack[i], inlineStack[i+1], offset));
        }
        return addr2lineInfos;
    }
}

class Addr2LineWithCache {
    private cache: Map<number, Addr2LineInfo[]> = new Map();
    private executable: string;
    private addr2lineProcess: ChildProcess;
    private nextCallback: (a: string) => void = () => { };

    constructor(exec: string) {
        this.executable = exec;
        this.addr2lineProcess = spawn("addr2line", ["-f", "--inlines", "-C", "-e", this.executable],
            { cwd: vscode.workspace.rootPath, stdio: ['pipe', 'pipe', 'ignore'] });
        this.addr2lineProcess.stdout?.on("data", (data) => this.nextCallback(data.toString()));
    };

    async addr2line(addr: number): Promise<Addr2LineInfo[]> {
        let line = this.cache.get(addr);
        if (line) {
            return line;
        } else {
            this.addr2lineProcess.stdin?.write(`0x${addr.toString(16)}\n`);
            return new Promise((resolve, reject) => {
                this.nextCallback = (data: string) => {
                    resolve(Addr2LineInfo.buildAddr2LineInfos(data, addr));
                };
            });
            // let stdout = execSync(`addr2line -f -s --inlines -C -e ${this.executable} 0x${addr.toString(16)}`, { cwd: vscode.workspace.rootPath }).toString();
            // let info = new Addr2LineInfo(stdout.trim(), addr);
            // this.cache.set(addr, info);
            // return info;
        }
    }

    kill() {
        this.addr2lineProcess.kill();
    }
}

class MMapResolver {
    private mmap: Map<string, number> = new Map();

    constructor() {
    };

    addMMapEvent(line: string) {
        if (!line.includes("PERF_RECORD_MMAP2")) {
            return;
        }
        const file = line.substr(line.indexOf("r-xp") + 4).trim();
        const mapping = line.substring(line.indexOf("[") + 1, line.lastIndexOf("]"));
        let mmapOffset = parseInt(mapping.substring(0, mapping.indexOf("(")), 16) -
            parseInt(mapping.substring(mapping.indexOf("@") + 2).split(" ", 1)[0], 16);
        this.mmap.set(file, mmapOffset);
    }

    ipToOffset(ip: number, file: string): number {
        let offset = this.mmap.get(file);
        if (!offset) {
            return 0;
        }
        return ip - offset;
    }
}

export function getPossibleEventsFromFs(): string[] {
    let possibleEvents: string[] = [];
    const config = vscode.workspace.getConfiguration('cppprofiler');
    readdirSync(`${vscode.workspace.rootPath}/${config.get("output")}`).forEach(file => {
        if (file.startsWith("perf.data") && file.endsWith(".dump")) {
            possibleEvents.push(file.split(".")[2]);
        }
    });
    return possibleEvents;
}

export async function parsePerfRecord(event?: string): Promise<PerfEventData | undefined> {
    let workspaceFolder = vscode.workspace.rootPath;
    if (!workspaceFolder) {
        return;
    }
    const config = vscode.workspace.getConfiguration('cppprofiler');
    if (!existsSync(`${workspaceFolder}/${config.get("output")}/perf.data`)) {
        return;
    }
    if (!event) {
        let possibleEvents = getPossibleEventsFromFs();
        if (possibleEvents.length <= 0) {
            return;
        }
        event = possibleEvents[0];
    }
    const mmapEvents = readFileSync(`${workspaceFolder}/${config.get("output")}/mmap-events.dump`, 'utf8');
    const mmapResolver = new MMapResolver();
    let executable: string | undefined;

    for (const line of mmapEvents.split("\n")) {
        mmapResolver.addMMapEvent(line);
        if (!executable && line.includes(workspaceFolder)) {
            executable = line.split("r-xp ")[1].trim();
        }
    }

    if (!executable) {
        return;
    }

    const dataStream = createReadStream(`${workspaceFolder}/${config.get("output")}/perf.data.${event}.dump`, 'utf8');
    const addr2line = new Addr2LineWithCache(executable);
    const perfEventData = new PerfEventData(mmapResolver, addr2line, executable);

    let data: string;
    await new Promise<void>((resolve, reject) => {
        dataStream.on('data', async (chunk) => {
            data += chunk;
            dataStream.pause();
            while (data.includes("\n\n")) {
                await perfEventData.addEvents(data.split("\n\n", 1)[0]);
                data = data.substring(data.indexOf("\n\n") + 2);
            }
            dataStream.resume();
        }).on('end', async () => {
            if (data.length > 0) {
                await perfEventData.addEvents(data);
            }
            await perfEventData.finalize();
            resolve();
        });
    });
    addr2line.kill();
    if (perfEventData.nrEventsInExecutable < 10) {
        vscode.window.showWarningMessage("Less than 10 events for your application - Consider extending the benchmarking time for example by doing multiple runs");
    }

    return perfEventData;
}

export class FunctionCall {
    public info: Addr2LineInfo;
    public nrSamples: number;
    public parentNrSamples: number = -1;

    public lines: Map<number, number> = new Map();
    public offsets: Map<number, number> = new Map();
    public subsequentialCalls: Map<string, FunctionCall> = new Map();

    constructor(addr2lineInfo: Addr2LineInfo) {
        this.info = addr2lineInfo;
        this.nrSamples = 1;
        this.offsets.set(addr2lineInfo.offset, 1);
        this.lines.set(addr2lineInfo.line, 1);
    }

    getSampleProportion() {
        return ((this.nrSamples / this.parentNrSamples) * 100).toFixed(2) + '%';
    }

    addCall(call: FunctionCall) {
        this.nrSamples++;
        for (let entry of call.lines.entries()) {
            let curr = this.lines.get(entry[0]);
            this.lines.set(entry[0], (curr ? curr : 0) + entry[1]);
        }
        for (let entry of call.offsets.entries()) {
            let curr = this.offsets.get(entry[0]);
            this.offsets.set(entry[0], (curr ? curr : 0) + entry[1]);
        }
    }

    addEvent(event: FunctionCall) {
        if (event.info.symbol === this.info.symbol) {
            this.addCall(event);
            return;
        }
        if (this.subsequentialCalls.has(event.info.symbol)) {
            this.subsequentialCalls.get(event.info.symbol)?.addEvent(event);
        } else {
            this.subsequentialCalls.set(event.info.symbol, event);
        }
    }

    getFunctionCalls(filter?: string): FunctionCall[] {
        let functions = [...this.subsequentialCalls.values()];
        if (filter) {
            return functions.filter((x) => x.info.filename === filter);
        }
        return functions;
    }

    async finalize() {
        [...this.subsequentialCalls.values()].forEach((x) => x.parentNrSamples = this.nrSamples);
    }

    async forEach(callback: (a: FunctionCall) => Promise<void>) {
        await callback(this);
        await Promise.all([...this.subsequentialCalls.values()].map(async (x) => await x.forEach(callback)));
    }
}

export class PerfEventData {
    private functions: Map<string, FunctionCall> = new Map();
    private mmapResolver: MMapResolver;
    private addr2lineResolver: Addr2LineWithCache;

    public totalNrEvents: number = 0;
    public nrEventsInExecutable: number = 0;
    public executable: string;

    constructor(mmapResolver: MMapResolver, addr2line: Addr2LineWithCache, executable: string) {
        this.mmapResolver = mmapResolver;
        this.addr2lineResolver = addr2line;
        this.executable = executable;
    }

    async addEvents(eventString: string) {
        this.totalNrEvents++;
        const stacktraceString = eventString.substr(eventString.indexOf("\n\t")); // Split off the header
        let functionStack: string[] = [];
        /*
         * Go through the stack trace in reversed order, so we can assure, that a parent 
         * function is alway already created once a child is processed
         */
        let stacktrace = stacktraceString.split("\n\t").reverse();
        for (const line of stacktrace) {
            if (line.includes(this.executable)) {
                let record = parsePerfStackTraceRecord(line);
                let offset = this.mmapResolver.ipToOffset(record.virtualAddr, this.executable);
                let addr2LineInfos = await this.addr2lineResolver.addr2line(offset);
                for (const addr2LineInfo of addr2LineInfos) {
                    this.addEvent(new FunctionCall(addr2LineInfo), functionStack);
                    functionStack.push(addr2LineInfo.symbol);
                }
            }
        }
    }

    addEvent(event: FunctionCall, stacktrace: string[]) {
        if (stacktrace.length === 0) {
            if (this.functions.has(event.info.symbol)) {
                this.functions.get(event.info.symbol)?.addCall(event);
            } else {
                this.functions.set(event.info.symbol, event);
            }
            return;
        }
        let e = this.functions.get(stacktrace[0]);
        for (let i = 1; i < stacktrace.length; i++) {
            e = e?.subsequentialCalls.get(stacktrace[i]);
        }
        e?.addEvent(event);
    }

    async forEach(callback: (a: FunctionCall) => Promise<void>) {
        await Promise.all([...this.functions.values()].map(async (x) => await x.forEach(callback)));
    }

    async finalize(){
        this.nrEventsInExecutable = this.getFunctionCalls().map((x) => x.nrSamples).reduce((acc, curr) => acc += curr);
            // For top level functions, evaluate the (correct) percentage
        await this.forEach(async (x) => { x.parentNrSamples = this.nrEventsInExecutable; });
        await this.forEach(async (x) => await x.finalize());
    }

    getFunctionCalls(): FunctionCall[] {
        return [...this.functions.values()];
    }

    async getLinesMap(filename: string): Promise<Map<number, number>> {
        let linesMap = new Map<number, number>();
        await this.forEach(async (elem) => {
            if (elem.info.filename === filename) {
                for (let entry of elem.lines.entries()) {
                    let curr = linesMap.get(entry[0]);
                    linesMap.set(entry[0], (curr ? curr : 0) + entry[1]);
                }
            }
        });
        return linesMap;
    }

    async getIPsMap(): Promise<Map<number, number>> {
        let ipMaps = new Map<number, number>();
        await this.forEach(async (elem) => {
            for (let entry of elem.offsets.entries()) {
                let curr = ipMaps.get(entry[0]);
                ipMaps.set(entry[0], (curr ? curr : 0) + entry[1]);
            }
        });
        return ipMaps;
    }
}

interface StackTraceRecord {
    name: string;
    virtualAddr: number;
}

function parsePerfStackTraceRecord(line: string): StackTraceRecord {
    let record: StackTraceRecord = { name: "", virtualAddr: 0 };
    let cleanedline = line.trim();
    record.virtualAddr = parseInt(cleanedline.substring(0, cleanedline.indexOf(" ")), 16);
    record.name = cleanedline.substring(cleanedline.indexOf(" "), cleanedline.lastIndexOf("(")).trim();
    if (record.name.includes("+")) {
        record.name = record.name.substring(0, record.name.lastIndexOf("+")).trim();
    }

    return record;
}