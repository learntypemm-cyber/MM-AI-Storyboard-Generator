import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RecapStudio from "./components/RecapStudio";
import { useEffect, useState } from "react";
import "./styles.css";
import "./studio-dark.css";
import "./visual-storyboard.css";
import "./studio-v2.css";
import "./recap.css";

function StudioSwitch() {
  const [studio, setStudio] = useState<"home" | "story" | "recap">(() => {
    const path = window.location.hash;
    return path === "#recap" ? "recap" : path === "#story" ? "story" : "home";
  });
  useEffect(() => {
    const sync = () => setStudio(window.location.hash === "#recap" ? "recap" : window.location.hash === "#story" ? "story" : "home");
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const select = (next: "home" | "story" | "recap") => { window.location.hash = next === "home" ? "" : next; setStudio(next); };
  if (studio === "recap") return <RecapStudio onBack={() => select("home")} />;
  if (studio === "story") return <><div className="studio-switch-bar"><button onClick={() => select("home")}>← Studios</button><strong>Story Studio</strong><button onClick={() => select("recap")}>Recap Studio →</button></div><App /></>;
  return <div className="studio-home"><div className="studio-home-inner"><span className="studio-home-mark">MM STORYBOARD</span><h1>ဘာလုပ်ချင်ပါသလဲ?</h1><p>Story နဲ့ Recap ကို သီးခြားစီ အလုပ်လုပ်နိုင်ပါတယ်။</p><div className="studio-home-grid"><button onClick={() => select("story")}><span>01 · STORY STUDIO</span><strong>ဇာတ်လမ်း ဖန်တီးမယ်</strong><small>ဇာတ်ညွှန်း၊ character၊ storyboard နှင့် Google Flow prompts</small><b>စတင်မယ် →</b></button><button onClick={() => select("recap")}><span>02 · RECAP STUDIO</span><strong>Video ကို မြန်မာလိုပြန်မယ်</strong><small>Video မှ စာသား၊ မြန်မာအသံနှင့် final MP4</small><b>စတင်မယ် →</b></button></div></div></div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><StudioSwitch /></React.StrictMode>);
