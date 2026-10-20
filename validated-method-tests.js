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
