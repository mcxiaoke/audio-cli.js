#!/usr/bin/env node
const util = require("util");
const { lookpath } = require("lookpath");
const fsWalk = require("@nodelib/fs.walk");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;
const h = require("./lib/helper");
const log = require("./lib/debug");
const un = require("./lib/unicode");
const cue = require("./lib/cue");
const { boolean, option } = require("yargs");
const metadata = require("music-metadata");
// debug and logging config
const prettyError = require("pretty-error").start();
prettyError.skipNodeFiles();

// https://www.exiftool.org/index.html#supported
// https://exiftool.org/TagNames/ID3.html

//////////////////////////////////////////////////////////////////////
// COMMAND LINE ARGS PARSE AND SETUP BEGIN
//////////////////////////////////////////////////////////////////////

const clamp = (num, min, max) => num > max ? max : num < min ? min : num;

const configCli = (argv) => {
  // log.setName("AudioCli");
  log.setLevel(argv.verbose);
  log.debug(argv);
};
const yargs = require("yargs/yargs")(process.argv.slice(2))
  .command(
    ["test", "$0"],
    "Test ffmpeg executable exists",
    (yargs) => { },
    (argv) => {
      cmdTest();
    }
  )
  .command(
    ["parse <input> [options]", "ps"],
    "Parse id3 metadata for audio files and save to database",
    (yargs) => {
      return yargs
        .positional("input", {
          describe: "Input folder that contains audio files",
          type: "string",
        })
        .option("save", {
          alias: "s",
          type: "boolean",
          describe: "Save parsed audio tags to database",
        });
    },
    (argv) => {
      cmdParse(argv);
    }
  )
  .command(
    ["split <input> [options]", "split", "sc"],
    "Split audio files by cue sheet and convert to m4a(aac)",
    (yargs) => {
      yargs
        .positional("input", {
          describe: "Input folder that contains audio files",
          type: "string",
        })
        .option("libfdk", {
          alias: ["fdk", "f"],
          type: "boolean",
          default: true,
          describe: "Use libfdk_aac encoder in ffmpeg command",
        });
    },
    (argv) => {
      cmdSplit(argv);
    }
  )
  .command(
    // format and name is important!
    // <> means required
    // [] means optional
    // <source> is argument name
    ["convert <input> [options]", "ct"],
    "Convert audio files to m4a(aac) format in input dir",
    (yargs) => {
      yargs
        .positional("input", {
          describe: "Input folder that contains audio files",
          type: "string",
        })
        .option("output", {
          alias: "o",
          describe: "Output folder that store audio files",
          type: "string",
        })
        .option("extensions", {
          alias: "e",
          type: "string",
          describe: "include files by extensions (eg. .wav|.flac)",
        })
        .option("libfdk", {
          alias: ["fdk", "f"],
          type: "boolean",
          default: true,
          describe: "Use libfdk_aac encoder in ffmpeg command",
        })
        .option("withtags", {
          alias: "w",
          type: "boolean",
          describe: "Parse audio tags",
        })
        .option("suffix", {
          type: "boolean",
          describe: "add bitrate suffix to filename",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          describe: "handle all files, default loseless audio",
        })
        .option("quality", {
          alias: "q",
          type: "string",
          default: "0",
          describe: "audio quality, bitrate, eg. 0(auto)/128/192/256/320",
        })
        .option("jobs", {
          alias: "j",
          describe: "multi jobs running parallelly",
          type: "number",
        });
    },
    (argv) => {
      cmdConvert(argv);
    }
  )
  .command(
    ["move <input> [options]", "mv"],
    "Move audio files by language in input dir",
    (yargs) => {
      yargs
        .positional("input", {
          describe: "Input folder that contains audio files",
          type: "string",
          normalize: true,
        })
        .option("lng", {
          alias: "l",
          type: "array",
          default: [],
          describe: "Audio language that should be move (cn,ja,kr,en)",
        })
        .option("unknown", {
          alias: "u",
          type: boolean,
          describe: "Move unclassified audio files to xx folder",
        });
    },
    (argv) => {
      cmdMove(argv);
    }
  )
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .usage("Usage: $0 <command> <input> [options]")
  .epilog("Move/Convert/Split audio files\nCopyright 2021 @ Zhang Xiaoke")
  .demandCommand(1, chalk.red("Missing command you want to execute!"))
  .showHelpOnFail()
  .help()
  .middleware([configCli]);
// this line is required to parse args
yargs.argv; //==yargs.parse()

//////////////////////////////////////////////////////////////////////
// COMMAND LINE ARGS PARSE AND SETUP END
//////////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////
// AUDIO CLI COMMON FUNCTIONS BEGIN
//////////////////////////////////////////////////////////////////////

async function listFiles(root, options = {}) {
  const startMs = Date.now();
  log.info("listFiles: Root", root, options);
  // https://www.npmjs.com/package/@nodelib/fs.walk
  // walk 31245 files in 31 seconds
  const files = await util.promisify(fsWalk.walk)(
    root,
    Object.assign(
      {
        stats: true,
        concurrency: 4 * cpuCount,
        followSymbolicLinks: false,
        throwErrorOnBrokenSymbolicLink: false,
        errorFilter: (error) => error.code == "ENOENT",
        // entryFilter: (entry) => h.isAudioFile(entry.path),
      },
      options || {}
    )
  );

  // https://www.npmjs.com/package/readdirp
  // walk 31245 files in 30 seconds
  // const files = await readdirp.promise(root, {
  //   fileFilter: options.fileFilter || options.entryFilter || Boolean,
  //   type: "files",
  //   alwaysStat: true,
  // });
  for (const [i, f] of files.entries()) {
    log.debug("listFiles: Item", i + 1, h.ps(f.path), h.fz(f.stats.size));
  }
  log.info(
    "listFiles: Result",
    `total ${files.length} files found in ${h.ht(startMs)}`
  );
  return files;
}

async function listAudio(root, loslessOnly = true) {
  return listFiles(root, { entryFilter: (entry) => loslessOnly ? h.isLosslessAudio(entry.path) : h.isAudioFile(entry.path) });
}

function selectAudioTag(mt) {
  if (!mt.format.tagTypes || mt.format.tagTypes.length == 0) {
    return;
  }
  for (const type of mt.format.tagTypes) {
    if (type !== "ID3v1") {
      return [type, mt.native[type]];
    }
  }
}

async function parseTags(files) {
  log.show("parseTags", `processing ${files.length} files`);
  const start = Date.now();
  const results = [];
  for (const [i, f] of files.entries()) {
    let mt;
    try {
      mt = await metadata.parseFile(f.path, { skipCovers: true });
      if (mt?.format.tagTypes && mt.format.tagTypes.length > 0) {
        log.info(
          "parseTags",
          i,
          files.length,
          h.ps(f.path),
          mt.common.artist,
          mt.common.title,
          mt.format.bitrate,
          mt.format.lossless
        );
      } else {
        log.info("parseTags", i, "no tags found", f.path);
      }
    } catch (error) {
      log.warn("parseTags", i, "no tags found", f.path, error.message);
      if (log.getLevel() >= 2) {
        console.error(i, error, f.path);
      }
    }

    f.tags = mt?.common;
    f.format = mt?.format;
    f.format && results.push(f);
  }
  const elapsed = Date.now() - start;
  log.info(
    "parseTags",
    `${results.length}/${files.length} files have tags ${elapsed}ms`
  );
  return results;
}

//////////////////////////////////////////////////////////////////////
// AUDIO CLI COMMON FUNCTIONS END
//////////////////////////////////////////////////////////////////////

async function cmdTest(argv) {
  const ffmpegBin = "ffmpeg";
  const p = await lookpath(ffmpegBin);
  if (p) {
    log.showGreen(`FFMPEG FOUND: ${p}`)
  } else {
    log.error(
      `You must have "${ffmpegBin}" in you PATH to use split and convert command!`
    );
  }
}

async function cmdParse(argv) {
  const input = path.resolve(argv.input);
  log.show("cmdParse Input:", input);
  let stats;
  try {
    stats = await fs.stat(input);
  } catch (error) {
    yargs.showHelp();
    log.error("cmdParse", `Invalid Input:`, input);
    return;
  }
  let startMs = Date.now();
  let files;
  if (stats.isFile()) {
    files = [{ path: input }].filter((f) => h.isAudioFile(f.path));
  } else if (stats.isDirectory()) {
    files = await listAudio(input);
  } else {
    files = [];
  }
  const fileCount = files.length;
  log.show(
    "cmdParse",
    `found ${fileCount} files in "${input}" ${h.ht(startMs)}`
  );
  startMs = Date.now();
  // maybe very slow over network
  files = await parseTags(files);
  log.show("cmdParse", `found tags for ${files.length} files ${h.ht(startMs)}`);
  argv.save && (await dbSaveTags(files));
}

async function cmdSplit(argv) {
  const root = path.resolve(argv.input);
  log.show("cmdSplit Input:", root);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("cmdSplit", "Invalid Input:", input);
    return;
  }
  const startMs = Date.now();
  let files = await listFiles(root, {
    entryFilter: (f) => h.ext(f.path, true) == ".cue",
  });
  files = await Promise.all(
    files.map(async (f) => {
      return await cue.findAudioFile(f.path);
    })
  );
  files = files.filter((f) => f.audio);
  for (const f of files) {
    log.show(`cmdSplit CUE`, f.audio, `(${path.basename(f.path)})`);
  }
  log.show(
    "cmdSplit",
    `found ${files.length} cue with audio files ${h.ht(startMs)}`
  );
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to split ${files.length} audio files by cue sheet?`
      ),
    },
  ]);
  if (answer.yes) {
    const results = await splitAllCue(files, argv.libfdk);
    for (const r of results) {
      if (r.failed && r.failed.length > 0) {
        for (const fd of r.failed) {
          log.warn("cmdSplit", fd.error, fd.file);
        }
      } else {
        log.showGreen(
          "cmdSplit",
          "All done",
          r.file.audio,
          path.basename(r.file.path)
        );
      }
    }
    log.showGreen(
      "cmdSplit",
      `Total ${results.length} audio files splitted by cue sheet.`
    );
  } else {
    log.showYellow("cmdSplit", "Will do nothing, aborted by user.");
  }
}

async function splitAllCue(files, useLibfdkAAC) {
  log.info("splitAllCue", `Adding ${files.length} tasks`);
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount / 2,
    workerType: "process",
  });
  const startMs = Date.now();
  const options = { logLevel: log.getLevel(), useLibfdkAAC: useLibfdkAAC };
  const results = await Promise.all(
    files.map(async (f, i) => {
      return await pool.exec("splitTracks", [f, i + 1, options]);
    })
  );
  await pool.terminate();
  log.info(
    "splitAllCue",
    `${results.length} cue files splitted to tracks in ${h.ht(startMs)}.`
  );
  return results;
}

async function cmdConvert(argv) {
  log.info("cmdConvert", argv);
  const root = path.resolve(argv.input);
  log.show("cmdConvert input:", root);
  log.show("cmdConvert output:", argv.output);
  if (!root || !await fs.pathExists(root)) {
    yargs.showHelp();
    log.error("cmdConvert", `Invalid Input: '${root}'`);
    return;
  }

  const startMs = Date.now();
  // list all files in dir recursilly
  // keep only non-m4a audio files
  // todo add check to ensure is audio file
  let files = await listFiles(root);
  files = files.sort((a, b) => a.path.localeCompare(b.path));
  const extensions = (argv.extensions || "").toLowerCase();
  if (extensions?.length >= 3) {
    files = files.filter(entry => extensions.includes(h.ext(entry.path)))
  } else {
    files = files.filter((entry) => argv.all ? h.isAudioFile(entry.path) : h.isLosslessAudio(entry.path))
  }
  const fileCount = files.length;
  log.show(
    "cmdConvert",
    `${files.length} audio files found in ${root} ${h.ht(startMs)}`
  );
  // caution: slow on network drives
  // files = await exif.readAllTags(files);
  // files = files.filter((f) => h.isAudioFile(f.path));
  // saveAudioDBTags(files);
  // use cached file with tags database
  if (!files || files.length == 0) {
    log.warn("cmdConvert", "Nothing to do, exit now.");
    return;
  }

  if (argv.withtags) {
    const taggedFiles = await parseTags(files);
    if (taggedFiles.length == 0 || taggedFiles.length < fileCount) {
      log.warn(
        "cmdConvert",
        `${fileCount - taggedFiles.length
        } files have no cached tags finally`
      );
    } else {
      files = taggedFiles;
    }
  }

  files = await checkFiles(files, argv);

  log.info(
    "cmdConvert",
    `Prepared ${files.length} valid audio files in ${h.ht(startMs)}`
  );
  const skipCount = fileCount - files.length;
  if (skipCount > 0) {
    log.info("cmdConvert", `after check ${skipCount} audio files are skipped`);
  }
  if (files.length == 0) {
    log.warn("Nothing to do, exit now.");
    return;
  }
  log.show(
    "cmdConvert",
    `There are ${files.length} audio files ready to convert`
  );
  const jobCount = clamp(Math.round(argv.jobs || cpuCount / 4), 1, 16);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to convert ${files.length} files to AAC format?`
      ),
    },
  ]);
  if (answer.yes) {
    const results = await convertAll(files, argv.libfdk || true, jobCount);
    log.showGreen(
      "cmdConvert",
      `All ${results.length} audio files are converted to AAC format.`
    );
  } else {
    log.showYellow("cmdConvert", "Will do nothing, aborted by user.");
  }
}

const QUALITY_LIST = ["128", "192", "256", "320"];

function checkOneFile(file, argv) {
  if (file.format) {
    file.bitrate = file.format.bitrate;
    file.lossless = file.format.lossless;
  } else if (h.isLosslessAudio(file.path)) {
    file.bitrate = 1000;
    file.lossless = true;
  } else {
    file.bitrate = 320;
    file.lossless = false;
  }

  let quality;
  if (QUALITY_LIST.includes(argv.quality)) {
    quality = `${argv.quality}k`;
  } else if (!file.lossless && file.bitrate <= 320) {
    quality = file.bitrate > 256 ? "256k" : "192k";
  } else {
    quality = "320k";
  }
  file.quality = quality;
  return quality;
}

async function checkFiles(files, argv) {
  const logTag = "Check";
  log.info(logTag, `before, files count:`, files.length);
  const results = await Promise.all(
    // true means keep
    // false mean skip
    files = files.map(async (f, i) => {

      const quality = checkOneFile(f, argv);

      const index = i + 1;
      const [dir, base, ext] = h.pathSplit(f.path);
      const dstDir = h.pathRewrite(dir, argv.output || dir || "output");
      const nameBase = argv.suffix ? `${base} [${quality}]` : `${base}`;
      const fileDst = path.join(dstDir, `${nameBase}.m4a`);
      const fileDstTemp = path.join(dstDir, `TMP_${nameBase}.m4a`);
      const fileDstSameDir = path.join(dir, `${nameBase}.m4a`);

      f.dstDir = dstDir;
      f.fileDst = fileDst;
      f.fileDstTemp = fileDstTemp;
      f.fileDstSameDir = fileDstSameDir;

      if (await fs.pathExists(fileDst)) {
        log.showGray(
          logTag,
          `E1: ${h.ps(fileDst)}`, index
        );
        return false;
      }

      if (await fs.pathExists(fileDstSameDir)) {
        log.showGray(
          logTag,
          `E2: ${h.ps(fileDstSameDir)}`, index
        );
        return false;
      }

      const cuefile = path.join(dir, `${base}.cue`);
      if (await fs.pathExists(cuefile)) {
        log.showGray(
          logTag,
          `SkipCUE ${h.ps(f.path)}`, index
        );
        return false;
      }

      log.info(logTag, `OK (${index}): ${h.ps(fileDst)}`);
      return f;
    })
  );
  files = results.filter(Boolean);
  log.info("checkFiles", `after, files count:`, files.length);
  return files;


}

async function convertAll(files, useLibfdk, jobCount) {
  log.info("convertAll", `Adding ${files.length} converting tasks fdk=${useLibfdk}`);
  const pool = workerpool.pool(`${__dirname}/audio_workers.js`, {
    maxWorkers: jobCount,
    workerType: "process",
  });
  log.debug("convertAll", pool);
  const startMs = Date.now();
  const options = { logLevel: log.getLevel(), useLibfdkAAC: useLibfdk };
  const results = await Promise.all(
    files.map(async (f, i) => {
      return await pool.exec("convertAudio", [f, i + 1, files.length, options]);
    })
  );
  await pool.terminate();
  log.info(
    "convertAll",
    `Result: ${results.length} files converted in ${h.ht(startMs)}.`
  );
  return results;
}

async function cmdMove(argv) {
  log.debug(`cmdMove:`, argv);
  const root = path.resolve(argv.input);
  const lng = argv.lng || [];
  if (!root || !(await fs.pathExists(root))) {
    log.error("cmdMove", `Invalid Input: '${root}'`);
    yargs.showHelp();
    return;
  }
  if (lng.length == 0) {
    log.error("cmdMove", `Language list is empty, abort!`);
    yargs.showHelp();

    return;
  }
  if (argv.unknown) {
    lng.push("xx");
  }
  let outputs = {};
  lng.forEach((x) => {
    outputs[x] = {
      id: x,
      input: [],
      output: path.join(path.dirname(root), `${path.basename(root)}_${x}`),
    };
  });
  log.debug("cmdMove", outputs);
  const startMs = Date.now();
  let files = await listAudio(root);
  log.show(`cmdMove: files count`, files.length);
  files = await parseTags(files);
  files = files.filter((f) => f.format && f.tags);
  log.show(`cmdMove: ${files.length} files have valid tags`);
  // let files = await readTagsFromDatabase(root);
  const fileCount = files.length;
  files.forEach((f, i) => {
    const t = f.tags;
    const title = t.title;
    const artist = t.artist;
    const name = path.basename(f.path);
    if (title && artist) {
      if (un.strHasHiraKana(name + title + artist)) {
        log.info(chalk.yellow(`JA: ${name} ${artist}-${title}`));
        outputs["ja"] &&
          outputs["ja"].input.push([
            f.path,
            path.join(outputs["ja"].output, name),
          ]);
      } else if (un.strHasHangul(name + title + artist)) {
        log.info(chalk.cyan(`KR: ${name} ${artist}-${title}`));
        outputs["kr"] &&
          outputs["kr"].input.push([
            f.path,
            path.join(outputs["kr"].output, name),
          ]);
      } else if (un.strHasHanyu(name + title + artist)) {
        log.info(chalk.green(`CN: ${name} ${artist}-${title}`));
        outputs["cn"] &&
          outputs["cn"].input.push([
            f.path,
            path.join(outputs["cn"].output, name),
          ]);
      } else if (un.strOnlyASCII(name + title + artist)) {
        // only ascii = english
        log.info(chalk.gray(`EN: ${name} ${artist}-${title}`));
        outputs.en &&
          outputs["en"].input.push([
            f.path,
            path.join(outputs["en"].output, name),
          ]);
      } else {
        log.info(chalk.gray(`MISC: ${name} ${artist}-${title}`));
        outputs["xx"] &&
          outputs["xx"].input.push([
            f.path,
            path.join(outputs["xx"].output, name),
          ]);
      }
    } else {
      log.info("cmdMove", `no valid tags: ${h.ps(f.path)}`);
    }
  });

  log.info("cmdMove", `Input: ${root} lng=${lng}`);
  let taskCount = 0;
  for (const [k, v] of Object.entries(outputs)) {
    taskCount += v.input.length;
    v.input.length > 0 &&
      log.showGreen(
        "cmdMove",
        `Prepared: [${v.id.toUpperCase()}] ${v.input.length
        } files will be moved to "${v.output}"`
      );
  }

  if (taskCount == 0) {
    log.warn("cmdMove", `No files need to be processed, abort.`);
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to move there files?`),
    },
  ]);
  if (answer.yes) {
    const dout = path.join(path.dirname(root), "duplicate");
    if (!fs.pathExists(dout)) {
      await fs.mkdir(dout);
    }
    async function ensureMove(src, dst) {
      log.debug(`Move: ${h.ps(src)} => ${h.ps(dst)}`);
      if (src == dst) {
        log.debug(`Skip:${src}`);
        return;
      }
      if (!(await fs.pathExists(src))) {
        log.info(`NotExists:${src}`);
        return;
      }
      try {
        if (await fs.pathExists(dst)) {
          log.debug(`Duplicate:${src}`);
          await fs.move(src, path.join(dout, path.basename(src)));
        } else {
          log.debug(`Moving to ${dst}`);
          await fs.move(src, dst);
          log.info(`Moved to ${dst}`);
        }
      } catch (error) {
        log.error("Move", error);
      }
    }
    // https://zellwk.com/blog/async-await-in-loops/
    // https://techbrij.com/javascript-async-await-parallel-sequence
    // paralell execute
    // outputs = await Promise.all(
    //   Object.entries(outputs).map(async ([k, v]) => {
    //     if (!fs.pathExistsSync(v.output)) {
    //       fs.mkdirSync(v.output);
    //     }
    //     if (v.input.length == 0) {
    //       return v;
    //     }
    //     v.results = await Promise.all(
    //       v.input.map(async (a) => {
    //         const [src, dst] = a;
    //         await ensureMove(src, dst);
    //         return dst;
    //       })
    //     );
    //     d.L(`Progress: ${v.results.length} ${v.id} files moved to ${v.output}`);
    //     return v;
    //   })
    // );
    // sequential execute
    for (const [k, v] of Object.entries(outputs)) {
      if (!fs.pathExistsSync(v.output)) {
        fs.mkdirSync(v.output);
      }
      if (v.input.length == 0) {
        continue;
      }
      v.results = await Promise.all(
        v.input.map(async (a) => {
          const [src, dst] = a;
          await ensureMove(src, dst);
          return dst;
        })
      );
      log.showGreen(
        "cmdMove",
        `Progress: ${v.results.length} ${v.id} files moved to ${v.output}`
      );
    }

    for (const [k, v] of Object.entries(outputs)) {
      v.results &&
        log.showGreen(
          "cmdMove",
          `Result: ${v.results.length} ${v.id} files moved to "${v.output}"`
        );
    }
    log.showGreen(
      "cmdMove",
      `Total ${fileCount} files processed in ${h.ht(startMs)}`
    );
  } else {
    log.warn("cmdMove", "Will do nothing, aborted by user.");
  }
}
