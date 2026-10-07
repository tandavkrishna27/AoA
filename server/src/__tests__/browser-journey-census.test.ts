import {describe,expect,it} from 'vitest';
import {accumulateDescendantPids} from './helpers/browser-journey-guest.js';

describe('governed guest descendant census',()=>{
  it('rejects an older Windows orphan whose parent PID was reused',()=>{
    const owned=new Set([1]);
    accumulateDescendantPids([{pid:2,parent:1,createdAt:100},{pid:3,parent:1,createdAt:201}],owned,200);
    expect([...owned]).toEqual([1,3]);
  });
  it('retains ownership and captures late nested children after the first approval',()=>{
    const owned=new Set([1]);
    accumulateDescendantPids([{pid:2,parent:1}],owned);
    expect([...owned]).toEqual([1,2]);
    // The original Chromium parent is now reparented. Its retained ownership
    // still binds a renderer and a late ffmpeg child to this exact guest.
    accumulateDescendantPids([{pid:2,parent:99},{pid:3,parent:2},{pid:4,parent:3},{pid:6,parent:99}],owned);
    accumulateDescendantPids([{pid:3,parent:99},{pid:4,parent:99},{pid:5,parent:4}],owned);
    expect([...owned]).toEqual([1,2,3,4,5]);
    expect(owned.has(6)).toBe(false);
  });
});
