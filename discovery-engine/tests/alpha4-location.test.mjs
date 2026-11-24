import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeLocation,normalizeTargetLocationInput,matchesConfiguredLocation,normalizedLocationKey} from '../src/services/locationNormalizer.mjs';
test('alpha4 location recognizes Amsterdam',()=>{const x=normalizeLocation('Amsterdam, Netherlands');assert.equal(x.countryCode,'NL');assert.equal(x.city,'Amsterdam')});
test('alpha4 location recognizes Boston region',()=>{const x=normalizeLocation('Boston, MA, United States');assert.equal(x.countryCode,'US');assert.equal(x.city,'Boston')});
test('alpha4 target country normalizes without city',()=>{const x=normalizeTargetLocationInput({label:'Switzerland'});assert.equal(x.countryCode,'CH');assert.equal(x.city,null)});
test('alpha4 matching rejects wrong configured country',()=>{const x=normalizeLocation('London, UK');assert.equal(matchesConfiguredLocation(x,[{enabled:1,country_code:'NL'}]),false);assert.equal(normalizedLocationKey(x),'gb|london|')});
