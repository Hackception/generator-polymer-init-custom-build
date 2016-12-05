const gulpNSP = require('gulp-nsp');


// Returns a function that returns a Promise to delete directories
function nsp(cb) {
  return gulpNSP({
    package: __dirname + '../package.json'
  }, cb);
}

module.exports = {
  check: nsp
};
