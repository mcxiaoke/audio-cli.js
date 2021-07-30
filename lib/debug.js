const util = require("util");
const log = require("loglevel");
const chalk = require("chalk");
const prefix = require("loglevel-plugin-prefix");

let loggerName = "";

const levelColors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.cyan,
  INFO: chalk.green,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

const msgColors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.gray,
  INFO: chalk.white,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

function applyCustomPlugin(logger, options) {
  options = options || {};
  const originalFactory = logger.methodFactory;
  logger.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function () {
      const chalkFunc = msgColors[methodName.toUpperCase()];
      const messages = [];
      for (let i = 0; i < arguments.length; i++) {
        // show object member details
        const arg =
          options.inspectObject && typeof arguments[i] === "object"
            ? util.inspect(arguments[i], {
                showHidden: false,
                depth: 3,
                // breakLength: Infinity,
              })
            : arguments[i];
        messages.push(options.coloredMessage ? chalkFunc(arg) : arg);
      }
      rawMethod.apply(undefined, messages);
    };
  };
  // Be sure to call setLevel method in order to apply plugin
  // logger.setLevel(logger.getLevel());
}

applyCustomPlugin(log, { inspectObject: true, coloredMessage: true });
prefix.reg(log);
prefix.apply(log, {
  levelFormatter(level) {
    return level.toUpperCase();
  },
  nameFormatter(name) {
    return name || loggerName;
  },
  timestampFormatter(date) {
    return date.toISOString();
  },
  format(level, name, timestamp) {
    let msg = `${levelColors[level](level)}`;
    name && name.trim().length > 0 && (msg += ` ${chalk.green(`${name}`)}`);
    return msg;
  },
});

module.exports.showGray = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.gray(a))));
};

module.exports.showRed = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))));
};

module.exports.showGreen = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.green(a))));
};

module.exports.showYellow = function (...args) {
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a)))
  );
};

module.exports.showBlue = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.blue(a))));
};

module.exports.showMagenta = function (...args) {
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.magenta(a)))
  );
};

module.exports.showCyan = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.cyan(a))));
};

module.exports.showWhite = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.white(a))));
};

module.exports.show = module.exports.showWhite;

module.exports.trace = function () {
  log.trace.apply(log, arguments);
};

module.exports.debug = function () {
  log.debug.apply(log, arguments);
};

module.exports.info = function () {
  log.info.apply(log, arguments);
};

module.exports.warn = function () {
  log.warn.apply(log, arguments);
};

module.exports.error = function () {
  log.error.apply(log, arguments);
};

module.exports.setLevel = (level) =>
  log.setLevel(Math.max(0, log.levels["WARN"] - level));

module.exports.getLevel = () =>
  Math.max(0, log.levels["WARN"] - log.getLevel());

module.exports.setName = (name) => (loggerName = name);
