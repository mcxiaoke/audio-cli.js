var verboseLevel = 0;

function setLevel(level) {
  verboseLevel = level;
}

function LOG() {
  console.log.apply(console, arguments);
}

function ERROR() {
  verboseLevel >= 0 && console.error.apply(console, arguments);
}

function WARN() {
  verboseLevel >= 0 && console.log.apply(console, arguments);
}
function INFO() {
  verboseLevel >= 1 && console.log.apply(console, arguments);
}
function DEBUG() {
  verboseLevel >= 2 && console.log.apply(console, arguments);
}

module.exports.setLevel = setLevel;
module.exports.L = LOG;
module.exports.E = ERROR;
module.exports.W = WARN;
module.exports.I = INFO;
module.exports.D = DEBUG;
