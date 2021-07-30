#!/usr/bin/env node
const util = require("util");
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
const { boolean } = require("yargs");
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");
const metadata = require("music-metadata");
// debug and logging config
const prettyError = require("pretty-error").start();
prettyError.skipNodeFiles();

// https://www.exiftool.org/index.html#supported
// https://exiftool.org/TagNames/ID3.html

//////////////////////////////////////////////////////////////////////
// COMMAND LINE ARGS PARSE AND SETUP BEGIN
//////////////////////////////////////////////////////////////////////

const configCli = (argv) => {
  // log.setName("AudioCli");
  log.setLevel(argv.verbose);
  log.debug(argv);
};
const yargs = require("yargs/yargs")(process.argv.slice(2))
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
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Force to override exists file",
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
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Force to override existing file",
        });
    },
    (argv) => {
      cmdConvert(argv);
    }
  )
  .command(
    ["move <input> [options]", "mv"],
    "Organize audio files by language in input dir",
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
          describe: "Audio language that should be moved (cn,ja,kr,en)",
        })
        .option("unknown", {
          alias: "u",
          type: boolean,
          describe: "Move unidentified audio files to xx folder",
        });
    },
    (argv) => {
      cmdMoveByLng(argv);
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

async function listFiles(root, options) {
  options = options || {};
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

async function listAudio(root) {
  return listFiles(root, { entryFilter: (entry) => h.isAudioFile(entry.path) });
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
  log.info("parseTags", `for ${files.length} files`);
  const start = Date.now();
  const results = [];
  for (const [i, f] of files.entries()) {
    let mt;
    try {
      mt = await metadata.parseFile(f.path, { skipCovers: true });
      if (mt && mt.format.tagTypes && mt.format.tagTypes.length > 0) {
        log.debug(
          "parseTags",
          i,
          f.path,
          mt.common.artist,
          mt.common.title,
          mt.format.tagTypes
        );
      } else {
        log.warn("parseTags", i, "no tags found", f.path);
      }
    } catch (error) {
      log.error("parseTags", i, "no tags found", f.path, error.message);
      if (log.getLevel() <= 1) {
        console.error(i, error, f.path);
      }
    }

    f.tags = mt && mt.common;
    f.tags && results.push(f);
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

//////////////////////////////////////////////////////////////////////
// AUDIO TAGS DATABASE METHODS BEGIN
//////////////////////////////////////////////////////////////////////

async function dbCreateTable(db) {
  // https://www.npmjs.com/package/sqlite
  await db.exec(
    `CREATE TABLE IF NOT EXISTS tags (
      size INTEGER, 
      filename TEXT NOT NULL, 
      path TEXT NOT NULL, 
      tags TEXT NOT NULL, 
      UNIQUE(path),
      PRIMARY KEY(path)
    );`
  );
  return db;
}

async function dbOpenDatabase(dbFile) {
  const filename = dbFile || "./data/audio.db";
  log.debug("dbOpenDatabase", filename);
  const fileDir = path.dirname(filename);
  if (!(await fs.pathExists(fileDir))) {
    await fs.mkdirs(fileDir);
  }
  sqlite3.verbose();
  const db = await sqlite.open({
    filename: filename,
    driver: sqlite3.Database,
  });
  await dbCreateTable(db);
  return db;
}

async function dbSaveTagRow(db, f) {
  if (!(db && f)) {
    throw new Error("Database and file object is required!");
  }
  const ret = await db.run(
    "INSERT OR REPLACE INTO tags VALUES (?,?,?,?)",
    f.size || f.stats.size || 0,
    path.basename(f.path),
    f.path,
    JSON.stringify(f.tags)
  );
  return ret;
}

async function dbSaveTags(files) {
  // const dbFile = "./data/audio.db";
  // if (await fs.pathExists(dbFile)) {
  //   await fs.move(dbFile, dbFile + "." + Date.now());
  // }
  const results = [];
  const db = await dbOpenDatabase();
  const dbStartMs = Date.now();
  // https://www.sqlite.org/lang_transaction.html
  db.run("BEGIN");
  try {
    for (const [i, f] of files.entries()) {
      const ret = await dbSaveTagRow(db, f);
      results.push(ret);
      log.debug("dbSaveTags", i, `row-${ret.lastID} added ${f.path} `);
    }
  } catch (error) {
    db.run("ROLLBACK");
    log.error("dbSaveTags rollback", error);
  }
  db.run("COMMIT");
  await db.close();
  log.info("dbSaveTags", `Insert ${files.length} rows in ${h.ht(dbStartMs)}`);
  return results;
}

async function dbReadTags(root) {
  const dbStartMs = Date.now();
  const db = await dbOpenDatabase();
  const rows = await db.all("SELECT * FROM tags");
  const files = await Promise.all(
    rows.map(async (row, i) => {
      try {
        log.debug("dbReadTags", "read", i, row.path, row.size);
        return {
          path: row.path,
          size: row.size,
          tags: JSON.parse(row.tags),
        };
      } catch (error) {
        d.E(error);
      }
    })
  );
  await db.close();
  log.info("dbReadTags", `Read ${rows.length} rows in ${h.ht(dbStartMs)}`);
  return files;
}

//////////////////////////////////////////////////////////////////////
// AUDIO TAGS DATABASE METHODS END
//////////////////////////////////////////////////////////////////////

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
    const results = await splitAllCue(files);
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

async function splitAllCue(files) {
  log.info("splitAllCue", `Adding ${files.length} tasks`);
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount - 1,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      return await pool.exec("splitTracks", [f, i + 1, log.getLevel()]);
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
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    log.error("cmdConvert", `Invalid Input: '${root}'`);
    return;
  }
  await executeConvert(root);
}

async function checkFiles(files) {
  const results = await Promise.all(
    // true means keep
    // false mean skip
    files.map(async (file, i) => {
      const f = file.path;
      const index = i + 1;
      // if (!(await fs.pathExists(f))) {
      //   d.I(`SkipNotFound (${index}) ${h.ps(f)}`);
      //   return false;
      // }
      if (!h.isAudioFile(f)) {
        return false;
      }
      if (h.ext(f, true) == ".m4a") {
        log.debug(chalk.gray(`SkipAAC (${index}): ${h.ps(f)}`));
        return false;
      }
      const aacName = h.getAACFileName(f);
      const p1 = path.join(path.dirname(f), "output", aacName);
      if (await fs.pathExists(p1)) {
        log.debug(`SkipExists (${i}): ${h.ps(p1)}`);
        return false;
      }
      const p2 = path.join(path.dirname(f), aacName);
      if (await fs.pathExists(p2)) {
        log.debug(`SkipExists (${index}): ${h.ps(p2)}`);
        return false;
      }
      log.info(`Prepared (${index}): ${h.ps(f)}`);
      return true;
    })
  );
  return files.filter((_v, i) => results[i]);
}

async function convertAllToAAC(files) {
  log.info(`convertAllToAAC: Adding ${files.length} tasks`);
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount - 1,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      const result = await pool.exec("toAACFile", [f, i + 1]);
      return result;
    })
  );
  await pool.terminate();
  log.info(`Result: ${results.length} files converted in ${h.ht(startMs)}.`);
  return results;
}

function appendAudioBitRate(f) {
  if (h.isLoselessAudio(f.path)) {
    f.bitRate = 1000;
    f.loseless = true;
    return f;
  }
  const bitRateTag = f.tags && f.tags.AudioBitrate;
  if (!bitRateTag) {
    return f;
  }
  const r = /(\d+)\.?\d*/;
  let bitRate = parseInt(bitRateTag);
  if (!bitRate) {
    const m = r.exec(bitRateTag);
    bitRate = parseInt(m && m[0]) || 0;
  }
  if (bitRate < 192) {
    log.debug(
      `appendAudioBitRate: ${bitRate} ${path.basename(f.path)} ${
        f.tags.MIMEType
      } ${f.tags.AudioBitrate}`
    );
  }
  f.bitRate = bitRate;
  return f;
}

async function executeConvert(root) {
  log.info(`executeConvert: ${root}`);
  const startMs = Date.now();
  // list all files in dir recursilly
  // keep only non-m4a audio files
  // todo add check to ensure is audio file
  const taskFiles = await checkFiles(await listAudioFiles(root));
  const taskPaths = taskFiles.map((f) => f.path);
  log.info(
    `executeConvert: ${taskPaths.length} audio files found in ${h.ht(startMs)}`
  );
  // caution: slow on network drives
  // files = await exif.readAllTags(files);
  // files = files.filter((f) => h.isAudioFile(f.path));
  // saveAudioDBTags(files);
  // use cached file with tags database
  if (!taskFiles || taskFiles.length == 0) {
    log.warn("Nothing to do, exit now.");
    return;
  }
  let files = await readAudioDBTags(root);
  log.info(`Total ${files.length} files parsed in ${h.ht(startMs)}`);
  files = files.filter((f) => taskPaths.includes(f.path));
  if (files.length == 0) {
    // new files not found in db
    // parse exif tags and save to db
    files = await exif.readAllTags(taskFiles);
    await saveAudioDBTags(files);
  }
  files = files.map((f) => appendAudioBitRate(f));
  log.info(`Total ${files.length} files after filterd in ${h.ht(startMs)}`);
  const filesCount = files.length;
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    log.info(`Total ${skipCount} audio files are skipped`);
  }
  log.info(`Input: ${root}`);
  if (files.length == 0) {
    log.info(chalk.green("Nothing to do, exit now."));
    return;
  }
  log.info(`Total ${files.length} audio files ready to convert`);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to convert ${files.length} files?`),
    },
  ]);
  if (answer.yes) {
    const results = await convertAllToAAC(files);
    log.info(chalk.green(`There are ${results.length} audio files converted.`));
  } else {
    log.info(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function cmdMoveByLng(argv) {
  log.debug(`cmdMoveByLng:`, argv);
  const root = path.resolve(argv.input);
  const lng = argv.lng || [];
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    log.error("cmdMoveByLng", `Invalid Input: '${root}'`);
    return;
  }
  if (lng.length == 0) {
    yargs.showHelp();
    log.error("cmdMoveByLng", `Language list is empty, abort!`);
    return;
  }
  if (argv.unknown) {
    lng.push("xx");
  }
  await executeMoveByLng(root, lng);
}

async function executeMoveByLng(root, lng = []) {
  let outputs = {};
  lng.forEach((x) => {
    outputs[x] = {
      id: x,
      input: [],
      output: path.join(path.dirname(root), `${path.basename(root)}_${x}`),
    };
  });
  log.info(`executeMoveByLng:`, root);
  log.info(outputs);
  const startMs = Date.now();
  let files = exif.listFiles(root);
  files = files.filter((f) => h.isAudioFile(f.path));
  log.info(`executeMoveByLng: files count`, files.length);
  files = await exif.readAllTags(files);
  files = files.filter((f) => {
    return f.tags && f.tags.Title && f.tags.Artist;
  });
  log.info(`executeMoveByLng: tags count`, files.length);
  // let files = await readTagsFromDatabase(root);
  const fileCount = files.length;
  files.forEach((f, i) => {
    const t = f.tags;
    const name = path.basename(f.path);
    if (t.Title && t.Artist) {
      if (un.strHasHiraKana(name + t.Title + t.Artist)) {
        log.info(chalk.yellow(`JA: ${name} ${t.Artist}-${t.Title}`));
        outputs["ja"] &&
          outputs["ja"].input.push([
            f.path,
            path.join(outputs["ja"].output, name),
          ]);
      } else if (un.strHasHangul(name + t.Title + t.Artist)) {
        log.info(chalk.cyan(`KR: ${name} ${t.Artist}-${t.Title}`));
        outputs["kr"] &&
          outputs["kr"].input.push([
            f.path,
            path.join(outputs["kr"].output, name),
          ]);
      } else if (un.strHasHanyu(name + t.Title + t.Artist)) {
        log.info(chalk.green(`CN: ${name} ${t.Artist}-${t.Title}`));
        outputs["cn"] &&
          outputs["cn"].input.push([
            f.path,
            path.join(outputs["cn"].output, name),
          ]);
      } else if (un.strOnlyASCII(name + t.Title + t.Artist)) {
        // only ascii = english
        log.info(chalk.gray(`EN: ${name} ${t.Artist}-${t.Title}`));
        outputs["en"] &&
          outputs["en"].input.push([
            f.path,
            path.join(outputs["en"].output, name),
          ]);
      } else {
        log.info(chalk.gray(`MISC: ${name} ${t.Artist}-${t.Title}`));
        outputs["xx"] &&
          outputs["xx"].input.push([
            f.path,
            path.join(outputs["xx"].output, name),
          ]);
      }
    } else {
      log.warn(`Invalid: ${path.basename(f.path)}`);
    }
  });

  log.info(`Input: ${root} lng=${lng}`);
  let taskCount = 0;
  for (const [k, v] of Object.entries(outputs)) {
    taskCount += v.input.length;
    log.info(
      `Prepared: [${v.id.toUpperCase()}] ${
        v.input.length
      } files will be moved to "${v.output}"`
    );
  }

  if (taskCount == 0) {
    log.warn(`No files need to be processed, abort.`);
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
      log.debug(`ensureMove: ${h.ps(src)} => ${h.ps(dst)}`);
      if (src == dst) {
        log.debug(`Skip:${src}`);
        return;
      }
      if (await fs.pathExists(src)) {
        log.debug(`NotExists:${src}`);
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
        log.error(error);
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
      log.showMagenta(
        `Progress: ${v.results.length} ${v.id} files moved to ${v.output}`
      );
    }

    for (const [k, v] of Object.entries(outputs)) {
      v.results &&
        log.showGreen(
          `Result: ${v.results.length} ${v.id} files moved to "${v.output}"`
        );
    }
    log.showGreen(`Total ${fileCount} files processed in ${h.ht(startMs)}`);
  } else {
    log.warn("Will do nothing, aborted by user.");
  }
}
