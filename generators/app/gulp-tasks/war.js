'use strict';

const gulp = require('gulp');
const gulpZip = require('gulp-zip');
const rename = require('gulp-rename');

function createWar() {
  return gulp.src(['build/bundled/**/*'])
    .pipe(gulpZip('ROOT.zip'))
    .pipe(rename('ROOT.war.tmp'))
    .pipe(gulp.dest('./target'));
}

module.exports = {
  create: createWar
};
