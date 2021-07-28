#!/usr/bin/env node
const klawSync = require("klaw-sync");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;
const h = require("./lib/helper");
const d = require("./lib/debug");
const un = require("./lib/unicode");
const exif = require("./lib/exif");
const { boolean } = require("yargs");
const sanitize = require("sanitize-filename");
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3");

// https://www.exiftool.org/index.html#supported
// https://exiftool.org/TagNames/ID3.html

const yargs = require("yargs/yargs")(process.argv.slice(2));
yargs
  .command(
    ["parse <source> [options]", "ps"],
    "Parse exif for audio files and save to database",
    (yargs) => {},
    (argv) => {
      d.I(argv);
      cmdParseTags(argv.source);
    }
  )
  .command(
    ["splitcue <source> [options]", "split", "sc"],
    "Split audio files by cue sheet to m4a(aac) format in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Force to override exists file",
        });
    },
    (argv) => {
      d.I(argv);
      cmdCueSplit(argv);
    }
  )
  .command(
    // format and name is important!
    // <> means required
    // [] means optional
    // <source> is argument name
    ["convert <source> [options]", "ct"],
    "Convert audio files to m4a(aac) format in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Force to override existing file",
        });
    },
    (argv) => {
      d.I(argv);
      cmdConvert(argv);
    }
  )
  .command(
    ["move <source> [options]", "mv"],
    "Organize and move audio files by language in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
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
          describe: "Ingore unknown language audio files (don't move)",
        });
    },
    (argv) => {
      d.I(argv);
      cmdMoveByLng(argv);
    }
  )
  .usage("Usage: $0 <command> <source> [options]")
  .epilog(
    "Rename/Move/Convert/Split audio files\nCopyright 2021 @ Zhang Xiaoke"
  )
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .demandCommand(1, chalk.red("Missing command you want to execute!"))
  .showHelpOnFail()
  .help();
d.setLevel(yargs.argv.verbose);
d.I(yargs.argv);

async function cmdCueSplit(argv) {
  console.log(argv);
  const root = path.resolve(argv.source);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await executeCueSplit(root);
}

async function executeCueSplit(root) {
  d.L(`executeCueSplit: ${root}`);
  const startMs = Date.now();
  let files = klawSync(root, { nodir: true });
  files = files.filter((f) => h.ext(f.path, true) == ".cue");
  for (const f of files) {
    d.L(`Found CUE: ${h.ps(f.path)}`);
  }
  d.L(`Total ${files.length} cue files found in ${h.ht(startMs)}`);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to split ${files.length} cue files?`
      ),
    },
  ]);
  if (answer.yes) {
    const results = await splitAllCue(files);
    for (const r of results) {
      if (r.failed && r.failed.length > 0) {
        for (const fd of r.failed) {
          console.log(chalk.red(`executeCueSplit: ${fd.error} ${fd.file}`));
        }
      } else {
        d.L(`executeCueSplit: all done for ${h.ps(r.file)}`);
      }
    }
    d.L(
      chalk.green(
        `executeCueSplit: total ${results.length} audio files splitted by cue sheet.`
      )
    );
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function splitAllCue(files) {
  d.L(`splitAllCue: Adding ${files.length} tasks`);
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount - 1,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      return await pool.exec("splitTracks", [f, i + 1]);
    })
  );
  await pool.terminate();
  d.L(
    `splitAllCue: ${results.length} cue files splitted to tracks in ${h.ht(
      startMs
    )}.`
  );
  return results;
}

async function cmdConvert(argv) {
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
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
        d.D(chalk.gray(`SkipAAC (${index}): ${h.ps(f)}`));
        return false;
      }
      const aacName = h.getAACFileName(f);
      const p1 = path.join(path.dirname(f), "output", aacName);
      if (await fs.pathExists(p1)) {
        d.D(chalk.gray(`SkipExists (${i}): ${h.ps(p1)}`));
        return false;
      }
      const p2 = path.join(path.dirname(f), aacName);
      if (await fs.pathExists(p2)) {
        d.D(chalk.gray(`SkipExists (${index}): ${h.ps(p2)}`));
        return false;
      }
      d.I(chalk.green(`Prepared (${index}): `) + `${h.ps(f)}`);
      return true;
    })
  );
  return files.filter((_v, i) => results[i]);
}

async function convertAllToAAC(files) {
  d.L(`convertAllToAAC: Adding ${files.length} tasks`);
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
  d.L(`Result: ${results.length} files converted in ${h.ht(startMs)}.`);
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
    d.D(
      `appendAudioBitRate: ${bitRate} ${path.basename(f.path)} ${
        f.tags.MIMEType
      } ${f.tags.AudioBitrate}`
    );
  }
  f.bitRate = bitRate;
  return f;
}

async function executeConvert(root) {
  d.L(`executeConvert: ${root}`);
  const startMs = Date.now();
  // list all files in dir recursilly
  // keep only non-m4a audio files
  // todo add check to ensure is audio file
  const taskFiles = await checkFiles(klawSync(root, { nodir: true }));
  const taskPaths = taskFiles.map((f) => f.path);
  d.L(
    `executeConvert: ${taskPaths.length} audio files found in ${h.ht(startMs)}`
  );
  // caution: slow on network drives
  // files = await exif.readAllTags(files);
  // files = files.filter((f) => h.isAudioFile(f.path));
  // saveAudioDBTags(files);
  // use cached file with tags database
  if (!taskFiles || taskFiles.length == 0) {
    d.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  let files = await readAudioDBTags(root);
  d.L(`Total ${files.length} files parsed in ${h.ht(startMs)}`);
  files = files.filter((f) => taskPaths.includes(f.path));
  if (files.length == 0) {
    // new files not found in db
    // parse exif tags and save to db
    files = await exif.readAllTags(taskFiles);
    await saveAudioDBTags(files);
  }
  files = files.map((f) => appendAudioBitRate(f));
  d.L(`Total ${files.length} files after filterd in ${h.ht(startMs)}`);
  const filesCount = files.length;
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    d.L(`Total ${skipCount} audio files are skipped`);
  }
  d.L(`Input: ${root}`);
  if (files.length == 0) {
    d.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  d.L(`Total ${files.length} audio files ready to convert`);
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
    d.L(chalk.green(`There are ${results.length} audio files converted.`));
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function createAudioTable(db) {
  // https://www.npmjs.com/package/sqlite
  await db.exec(
    `CREATE TABLE IF NOT EXISTS tags (
      size INTEGER, 
      filename TEXT NOT NULL, 
      path TEXT NOT NULL, 
      title TEXT NOT NULL, 
      artist TEXT NOT NULL, 
      tags TEXT NOT NULL, 
      UNIQUE(path),
      PRIMARY KEY(path)
    );`
  );
  return db;
}

async function openAudioDB(dbFile) {
  const filename = dbFile || "./data/audio.db";
  const fileDir = path.dirname(filename);
  if (!(await fs.pathExists(fileDir))) {
    await fs.mkdirs(fileDir);
  }
  sqlite3.verbose();
  const db = await sqlite.open({
    filename: filename,
    driver: sqlite3.Database,
  });
  await createAudioTable(db);
  return db;
}

async function saveAudioDBRow(db, f) {
  if (!(db && f)) {
    throw new Error("Database and file object is required!");
  }
  const ret = await db.run(
    "INSERT OR REPLACE INTO tags VALUES (?,?,?,?,?,?)",
    f.size || f.stats.size || 0,
    path.basename(f.path),
    f.path,
    f.tags.Title || "",
    f.tags.Artist || "",
    JSON.stringify(f.tags)
  );
  d.D(`saveAudioDBRow: row ${ret.lastID} for ${f.path} `);
}

async function saveAudioDBTags(files) {
  // const dbFile = "./data/audio.db";
  // if (await fs.pathExists(dbFile)) {
  //   await fs.move(dbFile, dbFile + "." + Date.now());
  // }
  const db = await openAudioDB();
  const dbStartMs = Date.now();
  db.run("BEGIN TRANSACTION");
  try {
    for (const f of files) {
      await saveAudioDBRow(db, f);
    }
  } catch (error) {
    d.E(error);
  }
  db.run("COMMIT TRANSACTION");
  await db.close();
  d.L(`saveAudioDBTags: ${files.length} rows added in ${h.ht(dbStartMs)}`);
}

async function readAudioDBTags(root) {
  const dbStartMs = Date.now();
  const db = await openAudioDB();
  const rows = await db.all("SELECT * FROM tags");
  const files = await Promise.all(
    rows.map(async (row, i) => {
      try {
        d.D(`Read row ${i} ${row.path} ${row.size}`);
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
  d.L(`Database read ${rows.length} rows in ${h.ht(dbStartMs)}`);
  return files;
}

async function cmdParseTags(root) {
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await executeParseTags(root);
}

async function executeParseTags(root) {
  // miragate json file to sqlite db
  // try {
  //   let files = await fs.readJSON("./data/alltags.json");
  //   files = files.filter((f) => f.tags && f.tags.Artist && f.tags.Title);
  //   await saveAudioDBTags(files);
  // } catch (error) {
  //   d.E(error);
  // }

  d.L(`Input: ${root}`);
  let startMs = Date.now();
  let files = exif.listFiles(root, (f) => h.isAudioFile(f.path));
  const fileCount = files.length;
  d.L(`executeParseTags: ${fileCount} files found in (${h.ht(startMs)})`);
  startMs = Date.now();
  // two slow over network
  files = await exif.readAllTags(files);
  d.L(`executeParseTags: ${fileCount} files parsed in ${h.ht(startMs)}`);
  try {
    const jsonName = sanitize(root);
    await fs.writeJSON(`./data/${jsonName}.json`, files);
    d.L(`executeParseTags: JSON ./data/${jsonName}.json`);
  } catch (error) {
    d.E("executeParseTags:", error);
  }
  await saveAudioDBTags(files);
}

async function cmdMoveByLng(argv) {
  d.I(`cmdMoveByLng:`, argv);
  const root = path.resolve(argv.source);
  const lng = argv.lng || [];
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  if (lng.length == 0) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Language list is empty, abort!`));
    return;
  }
  if (!argv.ignore) {
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
  d.L(`executeMoveByLng:`, root);
  d.I(outputs);
  const startMs = Date.now();
  let files = exif.listFiles(root);
  files = files.filter((f) => h.isAudioFile(f.path));
  d.L(`executeMoveByLng: files count`, files.length);
  files = await exif.readAllTags(files);
  files = files.filter((f) => {
    return f.tags && f.tags.Title && f.tags.Artist;
  });
  d.L(`executeMoveByLng: tags count`, files.length);
  // let files = await readTagsFromDatabase(root);
  const fileCount = files.length;
  files.forEach((f, i) => {
    const t = f.tags;
    const name = path.basename(f.path);
    if (t.Title && t.Artist) {
      if (un.strHasHiraKana(name + t.Title + t.Artist)) {
        d.I(chalk.yellow(`JA: ${name} ${t.Artist}-${t.Title}`));
        outputs["ja"] &&
          outputs["ja"].input.push([
            f.path,
            path.join(outputs["ja"].output, name),
          ]);
      } else if (un.strHasHangul(name + t.Title + t.Artist)) {
        d.I(chalk.cyan(`KR: ${name} ${t.Artist}-${t.Title}`));
        outputs["kr"] &&
          outputs["kr"].input.push([
            f.path,
            path.join(outputs["kr"].output, name),
          ]);
      } else if (un.strHasHanyu(name + t.Title + t.Artist)) {
        d.I(chalk.green(`CN: ${name} ${t.Artist}-${t.Title}`));
        outputs["cn"] &&
          outputs["cn"].input.push([
            f.path,
            path.join(outputs["cn"].output, name),
          ]);
      } else if (un.strOnlyASCII(name + t.Title + t.Artist)) {
        // only ascii = english
        d.I(chalk.gray(`EN: ${name} ${t.Artist}-${t.Title}`));
        outputs["en"] &&
          outputs["en"].input.push([
            f.path,
            path.join(outputs["en"].output, name),
          ]);
      } else {
        d.I(chalk.gray(`MISC: ${name} ${t.Artist}-${t.Title}`));
        outputs["xx"] &&
          outputs["xx"].input.push([
            f.path,
            path.join(outputs["xx"].output, name),
          ]);
      }
    } else {
      d.W(`Invalid: ${path.basename(f.path)}`);
    }
  });

  d.L(`Input: ${root} lng=${lng}`);
  let taskCount = 0;
  for (const [k, v] of Object.entries(outputs)) {
    taskCount += v.input.length;
    d.L(
      `Prepared: [${v.id.toUpperCase()}] ${
        v.input.length
      } files will be moved to "${v.output}"`
    );
  }

  if (taskCount == 0) {
    d.L(chalk.green(`No files need to be processed, abort.`));
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
      d.L(`ensureMove: ${h.ps(src)} => ${h.ps(dst)}`);
      if (src == dst) {
        // d.W(`Skip:${src}`);
        return;
      }
      if (await fs.pathExists(src)) {
        // d.W(`NotExists:${src}`);
        return;
      }
      try {
        if (await fs.pathExists(dst)) {
          // d.W(`Duplicate:${src}`);
          await fs.move(src, path.join(dout, path.basename(src)));
        } else {
          // d.D(`Moving to ${dst}`);
          await fs.move(src, dst);
          d.I(`Moved to ${dst}`);
        }
      } catch (error) {
        d.E(`ensureMove:${error}`);
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
      d.L(
        chalk.magenta(
          `Progress: ${v.results.length} ${v.id} files moved to ${v.output}`
        )
      );
    }

    for (const [k, v] of Object.entries(outputs)) {
      v.results &&
        d.L(
          chalk.green(
            `Result: ${v.results.length} ${v.id} files moved to "${v.output}"`
          )
        );
    }
    d.L(chalk.green(`Total ${fileCount} files processed in ${h.ht(startMs)}`));
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}
