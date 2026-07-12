import { Plugin } from "obsidian";

export default class ReaderMarginsPlugin extends Plugin {
  async onload() {
    // Wired up in later tasks. For now prove the plugin loads.
    console.log("reader-margins: onload");
  }
  onunload() {
    console.log("reader-margins: onunload");
  }
}
