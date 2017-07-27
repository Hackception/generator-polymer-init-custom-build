'use strict';

const path = require('path');

const del = require('del');
const gulp = require('gulp');
const commandLineArgs = require('command-line-args');

const gulpif = require('gulp-if');
const mergeStream = require('merge-stream');
const polymerBuild = require('polymer-build');

const babel = require('gulp-babel');
const babelPresetEnv = require('babel-preset-env');
const babiliPreset = require('babel-preset-babili');
const externalHelpersPlugin = require('babel-plugin-external-helpers');

const postCss = require('gulp-postcss');
const postHtml = require('gulp-posthtml');
const postHtmlPostCss = require('posthtml-postcss');
const autoprefixer = require('autoprefixer');
const cssSlam = require('css-slam').gulp;

const htmlMinifier = require('gulp-html-minifier');

// Build out the Polymer Project Config instance
const polymerProject = getProjectConfig(require('./polymer.json'), getArgs());

function runBuilds() {
  const mainBuildDirectoryName = 'build';
  const builds = polymerProject.config.builds || [];

  // Okay, so first thing we do is clear the build directory
  console.log(`Clearing ${mainBuildDirectoryName}${path.sep} directory...`);
  return del([mainBuildDirectoryName])
    .then(() => {
      return Promise.all(builds.map((options) => {
        // If no name is provided, write directly to the build/ directory.
        // If a build name is provided, write to that subdirectory.
        const buildName = options.name || 'default';
        const buildDirectory = path.join(mainBuildDirectoryName, buildName);

        return new Promise((resolve) => {
          console.log(`(${buildName}) Building...`);

          const htmlSplitter = new polymerBuild.HtmlSplitter();
          let buildStream = mergeStream(sourcesStream, depsStream)
            .pipe(htmlSplitter.split());

          // Compile ES6 JavaScript using babel w/ babel-preset-env
          if (options.js && options.js.compile) {
            buildStream = buildStream.pipe(gulpif(/^((?!(webcomponentsjs\/|webcomponentsjs\\)).)*\.js$/, babel({
              presets: [babelPresetEnv.buildPreset({}, {modules: false})],
              plugins: [externalHelpersPlugin],
            })));
          }
          // Minify JS using Babili
          if (options.js && options.js.minify) {
            buildStream = buildStream.pipe(gulpif(/^((?!(webcomponentsjs\/|webcomponentsjs\\)).)*\.js$/, babel({
              presets: [babiliPreset({}, {'simplifyComparisons': false})],
            })));
          }

          // Prefix CSS using AutoPrefixer
          if (options.css && options.css.prefix) {
            buildStream = buildStream.pipe(gulpif(/\.css$/, postCss([autoprefixer()])))
              // TODO: Remove once CSS is being properly isolated by split() and rejoin()
              .pipe(gulpif(/\.html$/, postHtml([postHtmlPostCss([autoprefixer()])])));
          }
          // Minify CSS using cssSlam
          if (options.css && options.css.minify) {
            buildStream = buildStream.pipe(gulpif(/\.css$/, cssSlam({stripWhitespace: true})))
              // TODO: Remove once CSS is being properly isolated by split() and rejoin()
              .pipe(gulpif(/\.html$/, cssSlam({stripWhitespace: true})));
          }

          // Minify HTML using html-minifier
          if (options.html && options.html.minify) {
            buildStream = buildStream.pipe(gulpif(/\.html$/, htmlMinifier({
              collapseWhitespace: true,
              removeComments: true,
            })));
          }

          buildStream = buildStream.pipe(htmlSplitter.rejoin());

          const compiledToES5 = !!(options.js && options.js.compile);
          if (compiledToES5) {
            buildStream = buildStream.pipe(polymerProject.addBabelHelpersInEntrypoint())
                              .pipe(polymerProject.addCustomElementsEs5Adapter());
          }

          // This will bundle dependencies into your fragments so you can lazy load them.
          if (options.bundle) {
            const bundlerOptions = {
              rewriteUrlsInTemplates: true, //!polymerVersion.startsWith('2.') // TODO: Check polymer version
            };
            if (typeof options.bundle === 'object') {
              Object.assign(bundlerOptions, options.bundle);
            }
            buildStream = buildStream.pipe(polymerProject.bundler(bundlerOptions));
          }

          // Add prefetch links
          if (options.insertPrefetchLinks) {
            buildStream = buildStream.pipe(polymerProject.addPrefetchLinks());
          }

          // Update baseTag
          if (options.basePath) {
            let basePath = options.basePath === true ? buildName : options.basePath;
            if (!basePath.startsWith('/')) {
              basePath = '/' + basePath;
            }
            if (!basePath.endsWith('/')) {
              basePath = basePath + '/';
            }
            buildStream = buildStream.pipe(polymerProject.updateBaseTag(basePath));
          }

          // Now let's generate the HTTP/2 Push Manifest
          if (options.addPushManifest) {
            buildStream = buildStream.pipe(polymerProject.addPushManifest());
          }

          // Okay, time to pipe to the build directory
          // Finish the build stream by piping it into the final build directory.
          buildStream = buildStream.pipe(gulp.dest(buildDirectory));

          // waitFor the buildStream to complete
          resolve(waitFor(buildStream));
        }).then(() => {
          // Okay, now let's generate the Service Worker
          if (options.addServiceWorker) {
            const swPrecacheConfigPath = path.resolve(
              polymerProject.config.root,
              options.swPrecacheConfig || 'sw-precache-config.js');
            const swPrecacheConfig = require(swPrecacheConfigPath);

            console.log(`(${buildName}) Generating the Service Worker...`);
            return polymerBuild.addServiceWorker({
              project: polymerProject,
              buildRoot: buildDirectory,
              bundled: !!(options.bundle),
              swPrecacheConfig: swPrecacheConfig || undefined,
            });
          }
        }).then(() => {
          // You did it!
          console.log(`(${buildName}) Build complete!`);
        }).catch((err) => {
          console.log('err', err);
        });
      }));
    });
}
gulp.task('build', runBuilds);

/**
 * Process CLI Args
 *
 * @return {Object}
 */
function getArgs() {
  // Define CLI options
  const optionDefinitions = [
    {name: 'presets', type: String, multiple: true},
    {name: 'add-service-worker', type: Boolean},
    {name: 'bundle', type: Boolean},
    {name: 'css-minify', type: Boolean},
    {name: 'html-minify', type: Boolean},
    {name: 'js-compile', type: Boolean},
    {name: 'js-minify', type: Boolean},
    {name: 'insert-prefetch-links', type: Boolean},
    {name: 'entrypoint', type: String},
    {name: 'shell', type: String},
    {name: 'fragment', type: String},
  ];

  // Get CLI options
  return commandLineArgs(optionDefinitions);
}
/**
 * Build out the PolymerProject based on polymer.json and CLI args
 *
 * @param {Object} polymerJson
 * @param {Object} cliArgs
 * @return {Object} - PolymerProject instance
 */
function getProjectConfig(polymerJson, cliArgs) {
  const allowedPresets = ['es5-bundled', 'es6-bundled', 'es6-unbundled'];

  if (Object.keys(cliArgs).length > 0) {
    if (cliArgs.presets) {
      // Check for allowed presets
      cliArgs.presets = cliArgs.presets.filter((preset) => allowedPresets.includes(preset));

      // Check for any pre-configured presets
      const configuredPresets = polymerJson.builds
        .filter((build) => build.preset)
        .map((build) => build.preset);

      // Use pre-configured else add preset
      polymerJson.builds = cliArgs.presets.map((preset) => {
        return configuredPresets.includes(preset) ?
          polymerJson.builds.find((build) => build.preset === preset) :
          {preset};
      });
    } else {
      // Create a custom build to use based on CLI flags
      polymerJson.builds = [{
        addServiceWorker: cliArgs['add-service-worker'] || false,
        insertPrefetchLinks: cliArgs['insert-prefetch-links'] || false,
        bundle: cliArgs.bundle,
        css: {
          minify: cliArgs['css-minify'] || false,
        },
        html: {
          minify: cliArgs['html-minify'] || false,
        },
        js: {
          compile: cliArgs['js-compile'] || false,
          minify: cliArgs['js-minify'] || false,
        },
      }];

      polymerJson.entrypoint = cliArgs.entrypoint || polymerJson.entrypoint;
      polymerJson.shell = cliArgs.shell || polymerJson.shell;
      if (cliArgs.fragment) {
        polymerJson.fragments = polymerJson.fragments.concat(cliArgs.fragment);
      }
    }
  }

  // Create Project Config
  return new polymerBuild.PolymerProject(polymerJson);
}
/**
 * Waits for the given ReadableStream
 * @param {ReadableStream} stream
 * @return {Promise}
 */
function waitFor(stream) {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}
