# CppProfiler
![Icon](resources/icon_small.png)

Cpp Profiler - allows to profile your cpp code utilizing the perf tool.  
Perf allows to track all sorts of different hardware events, reaching from cpu-cycles, over page or TLB misses to all kind of cache events and even further. These metrics can find bottlenecks in your code, cache inefficient structures or just visualize the program flow, by visualizing the events and attributing them to the corresponding line in your code - even down to assembler instruction level.

## Features

- Visualize distribution of events across single functions in your code - by expanding through your code
- Disassemble the key functions of the program
- Indicate the lines with a high number of recorded events - in cpp code or in assembler 

## Requirements

- **Perf**
- **Objdump**
- **Addr2line**

> Objdump and Addr2line will likely be already installed on your machine. And there is even a good chance, that the same applies to perf as well.

Furthermore for perf to be able to record events correctly, the kernel paranoid level has to be configured. This can be done by writing the level into `/proc/sys/kernel/perf_event_paranoid`.
To reduce the level to its minimum (and therefore record as much events as possible) run the following:
```
sudo sh -c "echo -1 > /proc/sys/kernel/perf_event_paranoid"
```  

## Workflow

1. Start by writing your cpp program
2. After building it you can than also run the `profile` Task ( **Terminal | Run Task** ). If it isn't automatically created from a `cppdbg` configuration you can add you own configuration, which might look similar to this own:
```
{
    "label": "Super Fancy Name",
    "type": "profile",
    "program": "./main",
    "additionalArguments": [
        "2"
    ],
}
```
3. Now you have got your perf output... Parse and view it by pressing reload in the new *Perf Profile* tab.

4. Now you can annotate the current open editors or just go through the tree view

> Disassembling doesn't require to run the perf task before. THereforeyou can just disassemble any of your binaries at any time.

## Extension Settings

* `cppprofiler.objdump.flags`: Flags for disassembling with objdump. Default is to use `--no-show-raw-insn -l --visualize-jumps --section=.text -C --disassemble` so we get the jumps visualized next to the original file lines and demangle the raw output.
* `cppprofiler.perf.flags`: Flags for perf record in addition to '-g'. Record various events with -e flag (e.g.: `-e L1-dcache-load-misses`, see `perf list` for more).
* `cppprofiler.executable`: The executable which should be disassembled (Only required, if disassembling is used WITHOUT profiling).

* `cppprofiler.output`: Folder for storing Perf output data.

* `cppprofiler.proportionLevel`: Visualize the proportion of event in relation to either all events happening in this file or the complete program.

## Known Issues

* Parsing the perf output can take its time, as te result can grow quite huge. - At least some way of caching should be implemented here in the future.

* The percentages show in the tree view, are the proportion of the respective parent. As events, that doesn't come from the traced program (e.g.: from the kernel or other shared objects) aren't cosidered here the don't have to sum up to a hundred.

* Perf related issues - some addresses just can't be resolved, ...

## Release Notes

### 0.0.1
*The very first version.* - **Enjoy!**
