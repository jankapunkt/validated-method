Package.describe({
  name: 'mdg:validated-method',
  summary: 'A simple wrapper for Meteor.methods',
  version: '2.0.0',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom(['2.3', '3.0']);

  api.use([
    'ecmascript',
    'check',
    'ddp',
  ]);

  api.mainModule('validated-method.js');
  api.export('ValidatedMethod');
});

Package.onTest(function (api) {
  // Dependencies of a tested package resolve to the oldest matching version,
  // so a `2.0.0 || 3.0.0` range would always pick the synchronous
  // SimpleSchema 2. Meteor 3 tools run on Node 20+, Meteor 2 tools on Node 14.
  const isMeteor3 = Number(process.versions.node.split('.')[0]) >= 20;

  api.use([
    'ecmascript',
    'meteortesting:mocha@2.0.0 || 3.0.0',
    isMeteor3 ? 'aldeed:simple-schema@3.0.0' : 'aldeed:simple-schema@2.0.0',
    'mdg:validated-method',
    'random'
  ]);

  if (process.env.VALIDATED_METHOD_COVERAGE) {
    api.addFiles('coverage-support/collect.js');
  }
  api.mainModule('validated-method-tests.js');
});
