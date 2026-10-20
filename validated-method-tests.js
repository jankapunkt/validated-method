import { Meteor } from 'meteor/meteor';
import { ValidatedMethod } from 'meteor/mdg:validated-method';
import SimpleSchema from 'simpl-schema';
import { assert } from 'chai';

const plainMethod = new ValidatedMethod({
  name: 'plainMethod',
  validate: new SimpleSchema({}).validator(),
  run() {
    return 'result';
  }
});

const noArgsMethod = new ValidatedMethod({
  name: 'noArgsMethod',
  validate: null,
  run() {
    return 'result';
  }
});

const methodWithArgs = new ValidatedMethod({
  name: 'methodWithArgs',
  validate: new SimpleSchema({
    int: { type: Number },
    string: { type: String },
  }).validator(),
  run() {
    return 'result';
  }
});

const methodThrowsImmediately = new ValidatedMethod({
  name: 'methodThrowsImmediately',
  validate: null,
  run() {
    throw new Meteor.Error('error');
  }
});

const methodReturnsName = new ValidatedMethod({
  name: 'methodReturnsName',
  validate: null,
  run() {
    return this.name;
  }
});

const methodWithSchemaMixin = new ValidatedMethod({
  name: 'methodWithSchemaMixin',
  mixins: [schemaMixin],
  schema: new SimpleSchema({
    int: { type: Number },
    string: { type: String },
  }),
  run() {
    return 'result';
  }
});

let resultReceived = false;
const methodWithApplyOptions = new ValidatedMethod({
  name: 'methodWithApplyOptions',
  validate: new SimpleSchema({}).validator(),
  applyOptions: {
    onResultReceived: function() {
      resultReceived = true;
    }
  },
  run() {
    return 'result';
  }
});

const asyncMethod = new ValidatedMethod({
  name: 'asyncMethod',
  validate: new SimpleSchema({
    param: { type: Number },
  }).validator(),
  async run({ param }) {
    return new Promise(resolve => {
		setTimeout(() => {
			resolve(['result', 'result2', param]);
		}, 1000);
	})
		.then(result => {
			return result.join(',');
		});
  }
});

function schemaMixin(methodOptions) {
  methodOptions.validate = methodOptions.schema.validator();
  return methodOptions;
}

describe('mdg:method', () => {
  it('defines a method that can be called', (done) => {
    plainMethod.call({}, (error, result) => {
      assert.equal(result, 'result');

      Meteor.call(plainMethod.name, {}, (error, result) => {
        assert.equal(result, 'result');
        done();
      });
    });
  });

  it('allows methods that take no arguments', (done) => {
    noArgsMethod.call((error, result) => {
      assert.equal(result, 'result');

      Meteor.call(noArgsMethod.name, (error, result) => {
        assert.equal(result, 'result');
        done();
      });
    });
  });

  it('allows methods to be called asynchronously', async () => {
    const result = await asyncMethod.callAsync({ param: 3000 });
    assert.equal(result, 'result,result2,3000');
  });


  [methodWithArgs, methodWithSchemaMixin].forEach((method) => {
    it('checks schema ' + method.name, async () => {
      const error = await new Promise(resolve => {
        method.call({}, error => resolve(error));
      });
      // 2 invalid fields
      assert.equal(error.details.length, 2);

      const result = await new Promise((resolve, reject) => {
        method.call({
          int: 5,
          string: "what",
        }, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
      });
      // All good!
      assert.equal(result, 'result');
    });
  });

  it('passes errors to callbacks', async () => {
    const error = await new Promise(resolve => {
      methodThrowsImmediately.call({}, error => resolve(error));
    });
    assert.instanceOf(error, Meteor.Error);
    assert.equal(error.error, 'error');
  });

  it('propagates errors if no callback is passed', async () => {
    if (Meteor.isServer) {
      // Meteor 3 server calls reject their returned promise.
      await methodThrowsImmediately.call({}).then(
        () => assert.fail('Expected the method call to reject'),
        error => {
          assert.instanceOf(error, Meteor.Error);
          assert.equal(error.error, 'error');
        }
      );
    } else {
      // Client stub errors still throw synchronously.
      assert.throws(() => {
        methodThrowsImmediately.call({});
      }, /error/);
    }
  });

  it('throws error if a mixin does not return the options object', () => {
    assert.throws(() => {
      new ValidatedMethod({
        name: 'methodWithFaultySchemaMixin',
        mixins: [function nonReturningFunction() {}],
        schema: null,
        run() {
          return 'result';
        }
      });
    }, /Error in methodWithFaultySchemaMixin method: The function 'nonReturningFunction' didn't return the options object/);

    assert.throws(() => {
      new ValidatedMethod({
        name: 'methodWithFaultySchemaMixin',
        mixins: [args => args, function () {}],
        schema: null,
        run() {
          return 'result';
        }
      });
    }, /Error in methodWithFaultySchemaMixin method: One of the mixins didn't return the options object/);
  });

  it('has access to the name on this.name', (done) => {
    const ret = methodReturnsName._execute();
    assert.equal(ret, 'methodReturnsName');

    methodReturnsName.call({}, (err, res) => {
      // The Method knows its own name
      assert.equal(res, 'methodReturnsName');

      done();
    });
  });

  it('can accept Meteor.apply options', (done) => {
    if (Meteor.isServer) {
      // the only apply option that I can think of to test is client side only
      return done();
    }

    resultReceived = false;
    methodWithApplyOptions.call({}, (err, res) => {
      // The Method knows its own name
      assert.equal(resultReceived, true);

      done();
    });
  });
});

if (Meteor.isServer) {
  describe('ValidatedMethod server contracts', () => {
    function fixture(overrides = {}) {
      const registrations = [];
      const connection = {
        methods(methods) { registrations.push(methods); },
      };
      const options = {
        name: 'serverContract',
        validate: null,
        run() { return 'result'; },
        connection,
        ...overrides,
      };
      return { options, connection, registrations };
    }

    async function rejectsWith(promise, expected) {
      await promise.then(
        () => assert.fail('Expected rejection'),
        error => assert.strictEqual(error, expected)
      );
    }

    it('registers once on a custom connection and preserves invocation context', () => {
      const args = { value: 42 };
      const context = { userId: 'user', name: 'oldName' };
      const result = {};
      const calls = [];
      const f = fixture({
        validate(received) {
          assert.strictEqual(this, context);
          assert.strictEqual(received, args);
          assert.equal(this.name, 'serverContract');
          assert.equal(this.userId, 'user');
          calls.push('validate');
        },
        run(received) {
          assert.strictEqual(this, context);
          assert.strictEqual(received, args);
          assert.equal(this.name, 'serverContract');
          assert.equal(this.userId, 'user');
          calls.push('run');
          return result;
        },
      });
      new ValidatedMethod(f.options);
      assert.lengthOf(f.registrations, 1);
      assert.deepEqual(Object.keys(f.registrations[0]), ['serverContract']);
      assert.strictEqual(f.registrations[0].serverContract.call(context, args), result);
      assert.deepEqual(calls, ['validate', 'run']);
    });

    for (const [label, connection] of [
      ['primitive', true], ['function', function () {}], ['missing methods', {}],
    ]) {
      it('rejects an invalid connection: ' + label, () => {
        const f = fixture({ connection });
        assert.throws(() => new ValidatedMethod(f.options), /Invalid connection type/);
        assert.isEmpty(f.registrations);
      });
    }

    for (const [label, applyOptions, expected] of [
      ['defaults', undefined, { returnStubValue: true, throwStubExceptions: true }],
      ['overrides', { returnStubValue: false, throwStubExceptions: false, wait: true },
        { returnStubValue: false, throwStubExceptions: false, wait: true }],
    ]) {
      it('forwards call arguments, callback, result and option ' + label, () => {
        const f = fixture({ applyOptions });
        const args = { value: 1 };
        const callback = () => {};
        const result = {};
        let captured;
        f.connection.apply = function (...received) {
          assert.strictEqual(this, f.connection);
          captured = received;
          return result;
        };
        const method = new ValidatedMethod(f.options);
        assert.strictEqual(method.call(args, callback), result);
        assert.deepEqual(captured, [method.name, [args], expected, callback]);
        assert.strictEqual(captured[1][0], args);
        assert.strictEqual(captured[2], method.applyOptions);
        assert.strictEqual(captured[3], callback);
      });
    }

    it('forwards callback-only calls with an empty argument object', () => {
      const f = fixture();
      const callback = () => {};
      let captured;
      f.connection.apply = (...args) => { captured = args; };
      const method = new ValidatedMethod(f.options);
      method.call(callback);
      assert.deepEqual(captured, [method.name, [{}], method.applyOptions, callback]);
    });

    it('delivers a synchronous transport error to the callback exactly once', () => {
      const f = fixture();
      const error = new Error('transport');
      f.connection.apply = () => { throw error; };
      const method = new ValidatedMethod(f.options);
      const received = [];
      assert.doesNotThrow(() => method.call({}, err => received.push(err)));
      assert.lengthOf(received, 1);
      assert.strictEqual(received[0], error);
    });

    it('rethrows the identical synchronous transport error without a callback', () => {
      const f = fixture();
      const error = new Error('transport');
      f.connection.apply = () => { throw error; };
      const method = new ValidatedMethod(f.options);
      assert.strictEqual(assert.throws(() => method.call({})), error);
    });

    for (const [label, value] of [
      ['false', false], ['null', null], ['zero', 0], ['object', {}],
      ['promise', Promise.resolve()],
    ]) {
      it('rejects a validator returning ' + label + ' before running', () => {
        let runs = 0;
        const f = fixture({ validate() { return value; }, run() { runs++; } });
        const method = new ValidatedMethod(f.options);
        assert.throws(() => method._execute({}, {}), /Returning from validate/);
        assert.equal(runs, 0);
      });
    }

    it('preserves a validation exception and does not run', () => {
      const error = new Error('validation');
      let runs = 0;
      const f = fixture({ validate() { throw error; }, run() { runs++; } });
      const method = new ValidatedMethod(f.options);
      assert.strictEqual(assert.throws(() => method._execute({}, {})), error);
      assert.equal(runs, 0);
    });

    for (const [label, result] of [['value', {}], ['promise', Promise.resolve('result')]]) {
      it('returns the identical run ' + label + ' after undefined validation', async () => {
        const calls = [];
        const f = fixture({
          validate() { calls.push('validate'); },
          run() { calls.push('run'); return result; },
        });
        const method = new ValidatedMethod(f.options);
        const actual = method._execute();
        assert.strictEqual(actual, result);
        assert.deepEqual(calls, ['validate', 'run']);
        await actual;
      });
    }

    for (const [label, overrides] of [
      ['missing name', { name: undefined }], ['invalid name', { name: 5 }],
      ['non-array mixins', { mixins: {} }], ['non-function mixin', { mixins: [1] }],
      ['missing validate', { validate: undefined }], ['invalid validate', { validate: true }],
      ['missing run', { run: undefined }], ['invalid run', { run: true }],
      ['invalid applyOptions', { applyOptions: true }],
    ]) {
      it('rejects ' + label + ' before registration', () => {
        const f = fixture(overrides);
        const error = assert.throws(() => new ValidatedMethod(f.options));
        assert.equal(error.errorType, 'Match.Error');
        assert.isEmpty(f.registrations);
      });
    }

    it('accepts validate: null and executes the registered method', () => {
      const f = fixture();
      new ValidatedMethod(f.options);
      assert.lengthOf(f.registrations, 1);
      assert.equal(f.registrations[0].serverContract.call({}), 'result');
    });

    it('passes replacement options through mixins in order', () => {
      const calls = [];
      let replacement;
      const custom = {};
      const f = fixture({
        custom,
        mixins: [
          options => {
            calls.push('first');
            replacement = { ...options, name: 'transformedContract' };
            return replacement;
          },
          options => {
            calls.push('second');
            assert.strictEqual(options, replacement);
            options.validate = function () { calls.push('validate'); };
            options.run = function () { calls.push('run'); return this.custom; };
            return options;
          },
        ],
      });
      const method = new ValidatedMethod(f.options);
      assert.strictEqual(method.custom, custom);
      assert.deepEqual(Object.keys(f.registrations[0]), ['transformedContract']);
      assert.strictEqual(method._execute({ custom }), custom);
      assert.deepEqual(calls, ['first', 'second', 'validate', 'run']);
    });

    it('stops mixin processing and registration after an invalid return', () => {
      let laterCalls = 0;
      const f = fixture({ mixins: [
        () => {},
        options => { laterCalls++; return options; },
      ] });
      assert.throws(() => new ValidatedMethod(f.options), /didn't return the options object/);
      assert.equal(laterCalls, 0);
      assert.isEmpty(f.registrations);
    });

    for (const field of ['validate', 'run']) {
      it('validates ' + field + ' after mixin transformation', () => {
        const f = fixture({ mixins: [options => ({ ...options, [field]: true })] });
        const error = assert.throws(() => new ValidatedMethod(f.options));
        assert.equal(error.errorType, 'Match.Error');
        assert.isEmpty(f.registrations);
      });
    }

    for (const rejects of [false, true]) {
      it('forwards server callAsync and preserves its ' + (rejects ? 'rejected' : 'resolved') + ' promise', async () => {
        const f = fixture({ applyOptions: { wait: true } });
        const args = { value: 1 };
        const value = rejects ? new Error('async transport') : {};
        const promise = rejects ? Promise.reject(value) : Promise.resolve(value);
        let captured;
        f.connection.applyAsync = function (...received) {
          assert.strictEqual(this, f.connection);
          captured = received;
          return promise;
        };
        const method = new ValidatedMethod(f.options);
        const actual = method.callAsync(args);
        assert.strictEqual(actual, promise);
        assert.deepEqual(captured, [method.name, [args], method.applyOptions]);
        assert.strictEqual(captured[1][0], args);
        assert.strictEqual(captured[2], method.applyOptions);
        if (rejects) await rejectsWith(actual, value);
        else assert.strictEqual(await actual, value);
      });
    }

    const rejectingMethod = new ValidatedMethod({
      name: 'validatedMethod.serverContracts.asyncRejection',
      validate: null,
      async run() { throw new Meteor.Error('server-contract-rejection'); },
    });

    it('propagates a real server async run rejection', async () => {
      await rejectingMethod.callAsync({}).then(
        () => assert.fail('Expected rejection'),
        error => {
          assert.instanceOf(error, Meteor.Error);
          assert.equal(error.error, 'server-contract-rejection');
        }
      );
    });
  });
}
