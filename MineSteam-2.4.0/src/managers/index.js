module.exports = Object.freeze({
  launch: require('./launchManager'),
  loaders: require('./loaderManager'),
  mods: require('./modManager'),
  modpacks: require('./modpackManager'),
  imports: require('./importManager'),
  instances: require('./instanceManager'),
  java: require('./javaManager'),
  diagnostics: require('./diagnosticManager'),
  content: require('./contentManager')
});
