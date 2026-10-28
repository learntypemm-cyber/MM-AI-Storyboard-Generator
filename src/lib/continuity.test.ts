import { describe, expect, it } from "vitest";
import type { Scene, Storyboard } from "../types";
import { auditSceneContinuity } from "./audit";

const scene = {
  id:"s1", openingFrame:"Bobo waits before fireworks start",
  visualDescription:"Bobo and Mohmoh wait", action:"Both are waiting", flowPrompt:"",
} as Scene;
const board = {
  scenes:[scene], referencePlan:[
    {id:"dog",kind:"character",title:"BOBO",prompt:"White dog",sceneIds:["s1"]},
    {id:"cat",kind:"character",title:"MOHMOH",prompt:"Black cat",sceneIds:[]},
  ],
} as Storyboard;

describe("continuity audit", () => {
  it("flags a missing character reference", () => {
    expect(auditSceneContinuity(scene,board)[0].ok).toBe(false);
  });
  it("passes when all named characters are linked", () => {
    const complete = {...board, referencePlan:board.referencePlan!.map(r => ({...r,sceneIds:["s1"]}))};
    expect(auditSceneContinuity(scene,complete).every(i => i.ok)).toBe(true);
  });
  it("finds a conflicting opening state", () => {
    const changed = {...scene,visualDescription:"Fireworks explode overhead"};
    expect(auditSceneContinuity(changed,board)[2].ok).toBe(false);
  });
});