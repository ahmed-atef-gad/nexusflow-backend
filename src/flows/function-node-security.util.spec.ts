import { validateFunctionNodeCode } from './function-node-security.util';

describe('validateFunctionNodeCode', () => {
  it('accepts a basic valid transformation', () => {
    const error = validateFunctionNodeCode(
      'msg.payload = Number(msg.payload) + 1; return msg;'
    );
    expect(error).toBeNull();
  });

  it('rejects require calls', () => {
    const error = validateFunctionNodeCode(
      "const fs = require('fs'); return msg;"
    );
    expect(error).toBe('require() is not allowed');
  });

  it('rejects prototype chain access', () => {
    const error = validateFunctionNodeCode(
      "msg.payload = msg.constructor.constructor('return 1')(); return msg;"
    );
    expect(error).toBe('Access to prototype chain properties is not allowed');
  });

  it('rejects code without return', () => {
    const error = validateFunctionNodeCode('msg.payload = 1;');
    expect(error).toBe('Code must have a return value');
  });

  it('rejects unknown identifiers', () => {
    const error = validateFunctionNodeCode('msg.payload = secret + 1; return msg;');
    expect(error).toBe("'secret' is not defined");
  });

  it('allows empty code to be defaulted by caller', () => {
    const error = validateFunctionNodeCode('');
    expect(error).toBeNull();
  });

  it('allows mapValue helper usage', () => {
    const error = validateFunctionNodeCode(
      'msg.payload = mapValue(Number(msg.payload?.raw ?? 0), 0, 4095, 0, 180); return msg;'
    );
    expect(error).toBeNull();
  });
});
