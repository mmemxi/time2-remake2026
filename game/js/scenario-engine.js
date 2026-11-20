(function () {
  "use strict";

  const scenarioFiles = Array.from({length: 12}, (_, index) => `../scenario/${index}.txt`);
  const scenarios = new Map();
  const itemDefinitions = new Map();
  const registers = Array(20).fill(0);
  const itemFlags = Array(100).fill(0);
  const legacyItemFlagNumbers = new Set([2, 3, 5, 10, 42, 64, 65, 66, 67, 68, 74, 75, 76, 80, 81, 82, 83, 84, 85, 90]);
  const layers = {bg: null, chr1: null, chr2: null, chr3: null};
  let currentMusic = "";
  let currentLoopingSound = "";
  let soundEffectSequence = 0;
  let lastAppliedSoundEffectSequence = 0;
  let suppressSoundEffectsThrough = 0;
  let currentSoundEffectEvents = [];
  let presentationRevision = 0;
  let pendingShakeLevel = null;
  let suppressShakeDuringRun = false;
  const itemAcquisitionOrder = new Map();
  let itemAcquisitionSequence = 0;
  let currentScene = 0;
  let currentPos = 0;
  let currentSceneName = "";
  let readyPromise = loadScenarios();
  let queuedLocation = null;
  let importedState = null;
  let suppressItemNotifications = false;
  let itemAddedDuringRun = false;
  let itemRemovedDuringRun = false;
  const optionalScenarioSources = new Map();

  window.line = (position) => runLocation(top.sys.page, Number(position));
  window.runLocation = runLocation;
  window.setvisual = () => syncLayers();
  window.resetScenarioState = resetScenarioState;
  window.exportScenarioState = exportScenarioState;
  window.importScenarioState = importScenarioState;
  window.getScenarioLocation = () => ({scene: currentScene, pos: currentPos, sceneName: currentSceneName, posName: currentPositionName()});
  window.hasGlobalSkipFlags = hasGlobalSkipFlags;
  window.isGlobalSkipAvailable = isGlobalSkipAvailable;
  window.getItemInventory = getItemInventory;
  window.refreshItemInventory = () => notifyItemInventory(false);
  window.applyMessagePresentation = (stage) => applyPresentationStage(stage, true);
  window.applyPendingPresentation = () => {
    const stage = top.sys.pendingPresentationStage;
    top.sys.pendingPresentationStage = null;
    if (stage) applyPresentationStage(stage, true);
  };
  window.stopLoopingSoundForFade = () => {
    currentLoopingSound = "";
    if (top.sys.pendingPresentationStage) top.sys.pendingPresentationStage.loopingSound = "";
    for (let index = 1; index <= top.sys.tcnt; index += 1) {
      const stage = top.sys.ltxt[index]?.presentationStage;
      if (stage) stage.loopingSound = "";
    }
  };

  async function loadScenarios() {
    const texts = await Promise.all(scenarioFiles.map(async (url) => {
      const response = await fetch(url, {cache: "no-store"});
      if (!response.ok) throw new Error(`シナリオを読み込めません: ${url} (${response.status})`);
      return response.text();
    }));
    texts.forEach((text, index) => parseScenarioFile(text, scenarioFiles[index]));
    validateScenarioStructure();
    await loadItemDefinitions();
    if (importedState) applyImportedState(importedState);
    if (queuedLocation) {
      const location = queuedLocation;
      queuedLocation = null;
      runLocation(location.scene, location.pos, location.options);
    }
  }

  async function loadItemDefinitions() {
    const url = "../scenario/items.txt";
    const response = await fetch(url, {cache: "no-store"});
    if (!response.ok) throw new Error("アイテム定義を読み込めません: " + url + " (" + response.status + ")");
    const lines = (await response.text()).replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
    lines.forEach((source, index) => {
      const line = source.trim();
      if (!line || line.startsWith("#")) return;
      const match = line.match(/^(i\d{1,2})[ \t]+(.+)$/i);
      if (!match) throw scenarioError(url, index + 1, "アイテム定義の形式が不正です");
      const flag = "i" + String(Number(match[1].slice(1))).padStart(2, "0");
      if (itemDefinitions.has(flag)) throw scenarioError(url, index + 1, "アイテムフラグが重複しています: " + flag);
      itemDefinitions.set(flag, match[2].trim());
    });
    notifyItemInventory(false);
  }

  function parseScenarioFile(source, sourceName) {
    const physicalLines = source.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
    let scene = null;
    let position = null;
    let rawCommands = [];

    const closePosition = () => {
      if (!position) return;
      position.commands = parseCommands(rawCommands, sourceName, position.sourceLine, scene?.number, position.number);
      rawCommands = [];
    };

    physicalLines.forEach((original, index) => {
      const trimmed = original.trim();
      if (trimmed.startsWith("@scene ")) {
        closePosition();
        const match = trimmed.match(/^@scene\s+(\d+)(?:\s+(\S+))?$/);
        if (!match) throw scenarioError(sourceName, index + 1, "@sceneの形式が不正です");
        const number = Number(match[1]);
        scene = {number, name: match[2] || "", positions: new Map(), sourceName, sourceLine: index + 1};
        if (scenarios.has(number)) {
          const first = scenarios.get(number);
          throw scenarioError(sourceName, index + 1, `@scene ${number} が重複しています`, {
            detail: `最初の定義: ${first.sourceName}:${first.sourceLine}`,
            hint: "シーン番号は全シナリオを通して一意にしてください。"
          });
        }
        scenarios.set(number, scene);
        position = null;
        return;
      }
      if (trimmed.startsWith("@pos ")) {
        closePosition();
        if (!scene) throw scenarioError(sourceName, index + 1, "@sceneより前に@posがあります");
        const match = trimmed.match(/^@pos\s+(\d+)(?:\s+(\S+))?$/);
        if (!match) throw scenarioError(sourceName, index + 1, "@posの形式が不正です");
        const number = Number(match[1]);
        if (scene.positions.has(number)) {
          const first = scene.positions.get(number);
          throw scenarioError(sourceName, index + 1, `@pos ${number} がScene ${scene.number}内で重複しています`, {
            scene: scene.number,
            pos: number,
            detail: `最初の定義: ${sourceName}:${first.sourceLine}`,
            hint: "同じScene内の@pos番号は一意にしてください。別の番号へ変更し、参照する@gotoや選択肢も合わせて修正してください。"
          });
        }
        position = {number, name: match[2] || "", sourceLine: index + 1, commands: []};
        scene.positions.set(number, position);
        return;
      }
      if (!position || !trimmed || trimmed.startsWith("#")) return;
      rawCommands.push({text: original, line: index + 1});
    });
    closePosition();
  }

  async function loadOptionalScenario(sceneNumber) {
    if (scenarios.has(sceneNumber)) return;
    const url = "../scenario/" + sceneNumber + ".txt";
    let source = optionalScenarioSources.get(sceneNumber);
    if (source === undefined) {
      const response = await fetch(url, {cache: "no-store"});
      if (!response.ok) throw new Error("グローバルスキップ用シナリオを読み込めません: " + url + " (" + response.status + ")");
      source = await response.text();
    }
    optionalScenarioSources.delete(sceneNumber);
    parseScenarioFile(source, url);
    if (!scenarios.has(sceneNumber)) throw new Error(url + "にシーン" + sceneNumber + "がありません");
    validateScenarioStructure();
  }

  async function isGlobalSkipAvailable() {
    if (!hasGlobalSkipFlags()) return false;
    if (scenarios.has(99) || optionalScenarioSources.has(99)) return true;
    try {
      const response = await fetch("../scenario/99.txt", {cache: "no-store"});
      if (!response.ok) return false;
      optionalScenarioSources.set(99, await response.text());
      return true;
    } catch (error) {
      return false;
    }
  }

  function parseCommands(lines, sourceName, startLine, sceneNumber, positionNumber) {
    let cursor = 0;
    const parseBlock = (terminators = []) => {
      const commands = [];
      let normalLines = [];
      const flushText = () => {
        while (normalLines.length && !normalLines[0].trim()) normalLines.shift();
        while (normalLines.length && !normalLines.at(-1).trim()) normalLines.pop();
        if (normalLines.length) commands.push({
          type: "text",
          text: normalLines.join("\n").replace(/\\n/g, "\n").replace(/\\r/g, "\uE000")
        });
        normalLines = [];
      };
      while (cursor < lines.length) {
        const entry = lines[cursor];
        const trimmed = entry.text.trim();
        const keyword = trimmed.split(/[ \t]+/, 1)[0];
        if (terminators.includes(keyword)) break;
        cursor += 1;
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (!trimmed.startsWith("@")) { normalLines.push(entry.text.trim()); continue; }
        flushText();
        if (keyword === "@if") {
          const condition = trimmed.slice(3).trim();
          const thenCommands = parseBlock(["@else", "@endif"]);
          let elseCommands = [];
          if (cursor < lines.length && lines[cursor].text.trim().startsWith("@else")) {
            cursor += 1;
            elseCommands = parseBlock(["@endif"]);
          }
          if (cursor >= lines.length || !lines[cursor].text.trim().startsWith("@endif")) {
            throw scenarioError(sourceName, entry.line, "@if に対応する @endif がありません", {
              scene: sceneNumber,
              pos: positionNumber,
              source: entry.text.trim(),
              hint: "条件分岐の末尾に@endifを追加してください。@posをまたいで@ifを継続することはできません。"
            });
          }
          cursor += 1;
          commands.push({type: "if", condition, thenCommands, elseCommands, line: entry.line});
          continue;
        }
        if (keyword === "@select") {
          const choices = [];
          while (cursor < lines.length && !lines[cursor].text.trim().startsWith("@end")) {
            const choiceEntry = lines[cursor++];
            const choiceLine = choiceEntry.text.trim();
            if (!choiceLine || choiceLine.startsWith("#")) continue;
            const fields = choiceLine.split(/[ \t]+/);
            if (fields[0] === "?") {
              if (fields.length < 4) throw scenarioError(sourceName, choiceEntry.line, "条件付き選択肢の形式が不正です");
              const target = fields.pop();
              const label = fields.pop();
              choices.push({condition: fields.slice(1).join(" "), label, target, line: choiceEntry.line});
            } else {
              if (fields.length !== 2) throw scenarioError(sourceName, choiceEntry.line, "選択肢の形式が不正です");
              choices.push({condition: "", label: fields[0], target: fields[1], line: choiceEntry.line});
            }
          }
          if (cursor >= lines.length) {
            throw scenarioError(sourceName, entry.line, "@select に対応する @end がありません", {
              scene: sceneNumber,
              pos: positionNumber,
              source: entry.text.trim(),
              hint: "選択肢の最終行の次に@endを追加してください。@posをまたいで選択肢を継続することはできません。"
            });
          }
          cursor += 1;
          commands.push({type: "select", choices, line: entry.line});
          continue;
        }
        const command = parseSimpleCommand(trimmed, sourceName, entry.line);
        if (command.line === undefined) command.line = entry.line;
        commands.push(command);
      }
      flushText();
      return commands;
    };
    return parseBlock();
  }

  function validateScenarioStructure() {
    const hasTransition = (commands) => commands.some((command) => {
      if (["goto", "select", "gameover", "ending", "exit"].includes(command.type)) return true;
      if (command.type === "if") return hasTransition(command.thenCommands) || hasTransition(command.elseCommands);
      return false;
    });

    const validateTarget = (target, scene, position, line, source) => {
      const parts = String(target).split(",");
      if (parts.length > 2 || parts.some((part) => !part)) {
        throw scenarioError(scene.sourceName, line, `ジャンプ先「${target}」の形式が不正です`, {
          scene: scene.number, pos: position.number, source,
          hint: "同一Sceneなら「場面番号または場面名」、別Sceneなら「シーン番号または名,場面番号または名」と記述してください。"
        });
      }
      const destinationScene = parts.length === 1 ? scene : findScenario(parts[0]);
      if (!destinationScene) {
        throw scenarioError(scene.sourceName, line, `ジャンプ先のScene「${parts[0]}」が存在しません`, {
          scene: scene.number, pos: position.number, source,
          hint: "@sceneの番号または名前と、ジャンプ先の指定が一致しているか確認してください。"
        });
      }
      const destination = parts.at(-1);
      const destinationPosition = findPosition(destinationScene, destination);
      if (!destinationPosition) {
        throw scenarioError(scene.sourceName, line, `ジャンプ先「Scene ${destinationScene.number} / pos ${destination}」が存在しません`, {
          scene: scene.number, pos: position.number, source,
          hint: `Scene ${destinationScene.number}に「@pos ${destination}」があるか、番号・場面名の入力ミスがないか確認してください。`
        });
      }
    };

    const inspectCommands = (commands, scene, position) => commands.forEach((command) => {
      if (command.type === "goto") validateTarget(command.target, scene, position, command.line, `@goto ${command.target}`);
      if (command.type === "select") command.choices.forEach((choice) => {
        validateTarget(choice.target, scene, position, choice.line, `選択肢「${choice.label}」 → ${choice.target}`);
      });
      if (command.type === "if") {
        inspectCommands(command.thenCommands, scene, position);
        inspectCommands(command.elseCommands, scene, position);
      }
    });

    scenarios.forEach((scene) => scene.positions.forEach((position) => {
      if (!hasTransition(position.commands)) {
        throw scenarioError(scene.sourceName, position.sourceLine, "この@posには次の場面へ進む命令がありません", {
          scene: scene.number,
          pos: position.number,
          source: `@pos ${position.number}`,
          detail: "メッセージ表示後、そのまま場面の末尾に到達します。",
          hint: "場面の最後に@goto、@select、@gameover、@ending、@exitのいずれかを追加してください。"
        });
      }
      inspectCommands(position.commands, scene, position);
    }));
  }

  function findScenario(value) {
    if (/^\d+$/.test(value)) return scenarios.get(Number(value));
    return Array.from(scenarios.values()).find((scene) => scene.name === value);
  }

  function findPosition(scene, value) {
    if (/^\d+$/.test(value)) return scene.positions.get(Number(value));
    return Array.from(scene.positions.values()).find((position) => position.name === value);
  }

  function parseSimpleCommand(line, sourceName, lineNumber) {
    let match;
    if ((match = line.match(/^@selif[ \t]+([^ \t]+)[ \t]+([^ \t]+)(?:[ \t]+([^ \t]+))?$/))) return {type: "dialogue", speaker: match[1], body: match[2].replace(/\\n/g, "\n"), voice: !match[3] || match[3] === "-" ? "" : match[3]};
    if ((match = line.match(/^@bg\s+(\S+)$/))) return {type: "bg", name: match[1]};
    if ((match = line.match(/^@(chr|chr[123])\s+(\S+)(?:\s+(\S+))?$/))) return {type: "character", slot: match[1] === "chr" ? "chr1" : match[1], single: match[1] === "chr", name: match[2], placement: match[3] || "right"};
    if (line.startsWith("@music ")) {
      const fields = line.split(/[ \t]+/).slice(1);
      const once = fields.at(-1) === "once";
      if (once) fields.pop();
      if (fields.length < 1 || fields.length > 2 || fields[0] === "off" && (fields.length > 1 || once)) {
        throw scenarioError(sourceName, lineNumber, `@musicの形式が不正です: ${line}`);
      }
      return {type: "music", name: fields[0], alternateName: fields[1] || "", once};
    }
    if ((match = line.match(/^@se\s+(\S+)$/))) return {type: "soundEffect", name: match[1]};
    if ((match = line.match(/^@ser\s+(\S+)$/))) return {type: "loopingSound", name: match[1]};
    if ((match = line.match(/^@goto\s+(\S+)$/))) return {type: "goto", target: match[1], line: lineNumber};
    if ((match = line.match(/^@flag([+-])\s+([fisgc]\d{1,2})$/i))) return {type: "flag", on: match[1] === "+", flag: match[2].toLowerCase()};
    if ((match = line.match(/^@reg\s+(?:r)?(\d{1,2}),([0-9]+)$/i))) return {type: "regSet", register: Number(match[1]), value: Number(match[2])};
    if ((match = line.match(/^@reg([+-])\s+(?:r)?(\d{1,2})$/i))) return {type: "regChange", register: Number(match[2]), amount: match[1] === "+" ? 1 : -1};
    if ((match = line.match(/^@fade(?:\s+(black|white))?(?:\s+(\d+(?:\.\d+)?|\.\d+))?$/))) {
      const duration = match[2] === undefined ? null : Number(match[2]);
      if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) throw scenarioError(sourceName, lineNumber, "@fadeの秒数は0より大きい数値で指定してください");
      return {type: "fade", mode: match[1] || "black", duration};
    }
    if ((match = line.match(/^@shake(?:\s+(\d+))?$/))) {
      const level = Number(match[1] || 0);
      if (!Number.isInteger(level) || level < 0 || level > 3) throw scenarioError(sourceName, lineNumber, "@shakeのレベルは0～3の半角数字で指定してください");
      return {type: "shake", level};
    }
    if (line === "@gameover") return {type: "gameover"};
    if ((match = line.match(/^@ending\s+(\d{1,2})\s+(.+)$/))) return {type: "ending", number: Number(match[1]), title: match[2]};
    if (line === "@exit") return {type: "exit"};
    throw scenarioError(sourceName, lineNumber, `未対応の命令です: ${line}`);
  }

  async function runLocation(sceneNumber, positionNumber, options = {}) {
    sceneNumber = Number(sceneNumber);
    positionNumber = Number(positionNumber);
    if (!Number.isFinite(sceneNumber) || !Number.isFinite(positionNumber)) return showRuntimeError("移動先が不正です");
    if (!scenarios.size) {
      queuedLocation = {scene: sceneNumber, pos: positionNumber, options};
      try { await readyPromise; } catch (error) { showRuntimeError(error.message); }
      return;
    }
    if (positionNumber === -1) { top.sys.returnToTitle(true); return; }
    if (!scenarios.has(sceneNumber) && sceneNumber === 99) {
      try { await loadOptionalScenario(99); }
      catch (error) { return showRuntimeError(error.message); }
    }
    const scene = scenarios.get(sceneNumber);
    const position = scene?.positions.get(positionNumber);
    if (!scene || !position) return showRuntimeError(`移動先がありません: scene ${sceneNumber}, pos ${positionNumber}`);
    const previousScene = currentScene;
    currentScene = sceneNumber;
    currentPos = positionNumber;
    currentSceneName = scene.name || `シーン${sceneNumber}`;
    top.sys.page = sceneNumber;
    top.sys.line = positionNumber;
    top.sys.clrtxt();
    top.stopVoice();
    if (options.textResume) top.pendingTextResumeState = options.textResume;
    const previousSuppression = suppressItemNotifications;
    const previousShakeSuppression = suppressShakeDuringRun;
    suppressItemNotifications = previousSuppression || options.suppressItemFlash === true;
    suppressShakeDuringRun = previousShakeSuppression || options.suppressShake === true || Boolean(options.textResume);
    const itemCountBefore = getItemInventory().length;
    itemAddedDuringRun = false;
    itemRemovedDuringRun = false;
    currentSoundEffectEvents = [];
    let result;
    try { result = executeCommands(position.commands, scene, position); }
    finally {
      suppressItemNotifications = previousSuppression;
      suppressShakeDuringRun = previousShakeSuppression;
    }
    const terminalPresentation = capturePresentationStage();
    if (options.suppressScenarioSoundEffects === true) suppressSoundEffectsThrough = soundEffectSequence;
    top.sys.pendingPresentationStage = terminalPresentation;
    const firstPresentation = Array.from({length: top.sys.tcnt}, (_, index) => top.sys.ltxt[index + 1]?.presentationStage).find(Boolean);
    applyPresentationStage(firstPresentation || terminalPresentation, false);
    const itemCountAfter = getItemInventory().length;
    const itemChange = options.suppressItemFlash === true || previousSuppression
      || (itemAddedDuringRun && itemRemovedDuringRun) || itemCountAfter === itemCountBefore
      ? false
      : (itemCountAfter > itemCountBefore ? "increase" : "decrease");
    if (!result.stopped) showRuntimeError(`${scene.sourceName} scene ${sceneNumber}, pos ${positionNumber}: ジャンプまたは終了処理がありません`);
    if (positionNumber === 0 && (sceneNumber === 0 || sceneNumber === 10 || sceneNumber === 11) && top.sys.tcnt === 0 && top.sys.scnt === 1) {
      const nextPos = top.sys.ls[1];
      const nextScene = top.sys.ls2[1] === 0 ? sceneNumber : top.sys.ls2[1];
      return runLocation(nextScene, nextPos, {suppressSceneTitle: true});
    }
    top.sys.savenow();
    top.sys.drawcnt = 0;
    top.sys.draw();
    notifyItemInventory(itemChange);
    if (!options.suppressSceneTitle && previousScene !== sceneNumber && scene.name && typeof top.showSceneTitle === "function") top.showSceneTitle(scene.name);
  }

  function executeCommands(commands, scene, position) {
    let stopped = false;
    for (const command of commands) {
      if (stopped) break;
      switch (command.type) {
        case "text":
          top.sys.put(escapeHtml(command.text).replace(/\n/g, "<br>"));
          top.sys.ltxt[top.sys.tcnt].presentationStage = capturePresentationStage(true);
          break;
        case "dialogue":
          top.sys.putDialogue(command.speaker, command.body, command.voice);
          top.sys.ltxt[top.sys.tcnt].presentationStage = capturePresentationStage(true);
          break;
        case "bg": setBackground(command.name); break;
        case "character": setCharacter(command); break;
        case "music": setMusic(command); break;
        case "soundEffect": queueSoundEffect(command.name); break;
        case "loopingSound": setLoopingSound(command.name); break;
        case "flag": setFlag(command.flag, command.on); break;
        case "regSet": setRegister(command.register, command.value); break;
        case "regChange": setRegister(command.register, getRegister(command.register) + command.amount); break;
        case "if": {
          const branch = evaluateCondition(command.condition) ? command.thenCommands : command.elseCommands;
          const textCountBeforeBranch = top.sys.tcnt;
          const branchResult = executeCommands(branch, scene, position);
          const lastBranchText = top.sys.ltxt[top.sys.tcnt];
          if (top.sys.tcnt > textCountBeforeBranch && lastBranchText && lastBranchText.type === "text") {
            if (!/<br\s*\/?>\s*$/i.test(lastBranchText.html || "")) lastBranchText.html += "<br>";
          }
          stopped = branchResult.stopped;
          break;
        }
        case "goto": addGoto(command.target, scene.number); stopped = true; break;
        case "select": {
          let count = 0;
          command.choices.forEach((choice) => {
            if (choice.condition && !evaluateCondition(choice.condition)) return;
            const target = resolveTarget(choice.target, scene.number);
            top.sys.sel(choice.label, target.pos, target.scene === scene.number ? 0 : target.scene);
            count += 1;
          });
          if (!count) showRuntimeError(`${scene.sourceName} scene ${scene.number}, pos ${position.number}: 表示できる選択肢がありません`);
          stopped = true;
          break;
        }
        case "fade": {
          const fadeRequest = {
            mode: command.mode === "white" ? 1 : 0,
            duration: command.duration,
            fadeBgm: true,
            fadeLoopingSound: true
          };
          const previousMessage = top.sys.ltxt[top.sys.tcnt];
          if (previousMessage) previousMessage.fadeAfter = fadeRequest;
          else top.sys.deferredFadePending = fadeRequest;
          break;
        }
        case "shake":
          pendingShakeLevel = command.level;
          presentationRevision += 1;
          break;
        case "gameover": top.sys.gameOverPending = true; stopped = true; break;
        case "ending": top.sys.endingPending = {number: command.number, title: command.title}; stopped = true; break;
        case "exit": top.sys.exitPending = true; stopped = true; break;
      }
    }
    syncLayers();
    return {stopped};
  }

  function addGoto(targetText, sameScene) {
    const target = resolveTarget(targetText, sameScene);
    top.sys.sel("　次へ　", target.pos, target.scene === sameScene ? 0 : target.scene);
  }

  function resolveTarget(text, sameScene) {
    const parts = text.split(",");
    if (parts.length === 1) return {scene: sameScene, pos: resolvePosition(scenarios.get(sameScene), parts[0])};
    const scene = resolveScene(parts[0]);
    return {scene: scene.number, pos: resolvePosition(scene, parts[1])};
  }

  function resolveScene(value) {
    if (/^\d+$/.test(value)) return scenarios.get(Number(value));
    return Array.from(scenarios.values()).find((scene) => scene.name === value);
  }

  function resolvePosition(scene, value) {
    if (!scene) throw new Error("シーンが見つかりません");
    if (/^\d+$/.test(value)) return Number(value);
    const position = Array.from(scene.positions.values()).find((candidate) => candidate.name === value);
    if (!position) throw new Error(`場面が見つかりません: ${value}`);
    return position.number;
  }

  function setBackground(name) {
    layers.bg = name === "off" ? null : {name, x: 0, y: 0, w: 400, h: 300, kind: "jpg"};
    presentationRevision += 1;
  }

  function setCharacter(command) {
    if (command.single) { layers.chr2 = null; layers.chr3 = null; }
    if (command.name === "off") layers[command.slot] = null;
    else {
      const placement = parsePlacement(command.placement);
      layers[command.slot] = {name: command.name, ...placement, kind: "gif"};
    }
    presentationRevision += 1;
  }

  function parsePlacement(value) {
    const presets = {
      left: {x: -20, y: 0, w: 240, h: 300},
      center: {x: 80, y: 0, w: 240, h: 300},
      right: {x: 160, y: 0, w: 240, h: 300}
    };
    if (presets[value]) return presets[value];
    const values = value.split(",").map(Number);
    if (values.length !== 4 || values.some((number) => !Number.isFinite(number))) throw new Error(`人物座標が不正です: ${value}`);
    return {x: values[0], y: values[1], w: values[2], h: values[3]};
  }

  function setMusic(command) {
    if (command.name === "off") {
      currentMusic = "";
      presentationRevision += 1;
      return;
    }
    if (command.alternateName) {
      const encoded = [command.once ? "1" : "0", command.name, command.alternateName].map(encodeURIComponent).join("|");
      currentMusic = `modebgm|${encoded}`;
      presentationRevision += 1;
      return;
    }
    currentMusic = `${command.once ? "@" : ""}${command.name}.mid`;
    presentationRevision += 1;
  }

  function queueSoundEffect(name) {
    currentSoundEffectEvents.push({id: ++soundEffectSequence, name});
    presentationRevision += 1;
  }

  function setLoopingSound(name) {
    currentLoopingSound = name === "off" ? "" : name;
    presentationRevision += 1;
  }

  function capturePresentationStage(consumeShake = false) {
    const shake = consumeShake && pendingShakeLevel !== null && !suppressShakeDuringRun
      ? {level: pendingShakeLevel}
      : null;
    const stage = {
      revision: presentationRevision,
      layers: JSON.parse(JSON.stringify(layers)),
      music: currentMusic,
      loopingSound: currentLoopingSound,
      soundEffects: currentSoundEffectEvents.map((event) => ({...event})),
      shake
    };
    if (consumeShake) pendingShakeLevel = null;
    return stage;
  }

  function applyPresentationStage(stage, renderNow) {
    if (!stage) return;
    Object.keys(layers).forEach((key) => layers[key] = stage.layers?.[key] || null);
    currentMusic = typeof stage.music === "string" ? stage.music : "";
    currentLoopingSound = typeof stage.loopingSound === "string" ? stage.loopingSound : "";
    if (typeof top.setLoopingScenarioSound === "function") top.setLoopingScenarioSound(currentLoopingSound);
    if (Array.isArray(stage.soundEffects)) stage.soundEffects.forEach((event) => {
      if (!event || event.id <= lastAppliedSoundEffectSequence) return;
      lastAppliedSoundEffectSequence = event.id;
      if (event.id <= suppressSoundEffectsThrough) return;
      if (typeof top.playScenarioSound === "function") top.playScenarioSound(event.name);
    });
    syncLayers();
    top.sys.bgm(currentMusic);
    if (!renderNow) return;
    const shouldShake = Boolean(stage.shake && typeof top.startScreenShake === "function"
      && !(typeof top.isTextSkipActive === "function" && top.isTextSkipActive()));
    top.sys.drawcnt = 1;
    top.renderGraphics(top.sys.drawgrp(), shouldShake ? false : !top.sys.skipVisualEffect);
    top.sys.skipVisualEffect = false;
    if (shouldShake) top.forceImmediateBgmSwitch = true;
    top.sys.chgbgm();
    if (shouldShake) top.startScreenShake(stage.shake.level);
    top.sys.savenow();
  }

  function syncLayers() {
    if (!top.sys?.lgrp) return;
    top.sys.gcnt = 0;
    [layers.bg, layers.chr1, layers.chr2, layers.chr3].forEach((layer) => {
      if (!layer) return;
      top.sys.layer(`${layer.name}.${layer.kind}`, layer.x, layer.y, layer.w, layer.h);
    });
    top.sys.drawcnt = 0;
  }

  function setFlag(name, on) {
    const prefix = name[0];
    const number = Number(name.slice(1));
    if (prefix === "g") {
      localStorage.setItem(globalSkipFlagKey(number), on ? "1" : "0");
      return;
    }
    if (prefix === "c") {
      localStorage.setItem(galleryFlagKey(number), on ? "1" : "0");
      return;
    }
    if (prefix === "i") {
      const normalized = "i" + String(number).padStart(2, "0");
      const previous = itemFlags[number] || 0;
      itemFlags[number] = on ? 1 : 0;
      if (previous !== itemFlags[number] && itemDefinitions.has(normalized)) {
        if (itemFlags[number]) {
          itemAcquisitionOrder.set(normalized, ++itemAcquisitionSequence);
          itemAddedDuringRun = true;
        } else {
          itemAcquisitionOrder.delete(normalized);
          itemRemovedDuringRun = true;
        }
      }
      return;
    }
    if (prefix === "s") localStorage.setItem(`Time2:SystemFlag:s${String(number).padStart(2, "0")}`, on ? "1" : "0");
    else top.sys.flg[number] = on ? 1 : 0;
  }

  function getFlag(name) {
    const prefix = name[0];
    const number = Number(name.slice(1));
    if (prefix === "g") return localStorage.getItem(globalSkipFlagKey(number)) === "1" ? 1 : 0;
    if (prefix === "c") return localStorage.getItem(galleryFlagKey(number)) === "1" ? 1 : 0;
    if (prefix === "i") return itemFlags[number] || 0;
    if (prefix === "s") return localStorage.getItem(`Time2:SystemFlag:s${String(number).padStart(2, "0")}`) === "1" ? 1 : 0;
    return Number(top.sys.flg[number]) || 0;
  }

  function globalSkipFlagKey(number) {
    return "Time2:GlobalSkipFlag:g" + String(number).padStart(2, "0");
  }

  function galleryFlagKey(number) {
    return "Time2:GalleryFlag:c" + String(number).padStart(2, "0");
  }

  function hasGlobalSkipFlags() {
    for (let number = 0; number < 100; number += 1) {
      if (getFlag("g" + String(number).padStart(2, "0"))) return true;
    }
    return false;
  }

  function getItemInventory() {
    if (!top.sys || !Array.isArray(top.sys.flg)) return [];
    return Array.from(itemDefinitions, ([flag, name]) => ({flag, name}))
      .filter((item) => getFlag(item.flag) === 1)
      .sort((left, right) => (itemAcquisitionOrder.get(right.flag) || 0) - (itemAcquisitionOrder.get(left.flag) || 0));
  }

  function notifyItemInventory(change) {
    if (typeof top.updateItemInventory === "function") top.updateItemInventory(getItemInventory(), change || false);
  }

  function setRegister(number, value) {
    if (number < 0 || number >= registers.length) throw new Error(`レジスタ番号が範囲外です: r${number}`);
    registers[number] = Math.max(0, Math.floor(Number(value) || 0));
  }

  function getRegister(number) { return registers[number] || 0; }

  function evaluateCondition(expression) {
    const tokens = expression.match(/f\d{1,2}|i\d{1,2}|s\d{1,2}|g\d{1,2}|c\d{1,2}|r\d{1,2}|mode|original|remake|on|off|\d+|==|!=|<=|>=|&&|\|\||[()!<>]/gi) || [];
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];
    const primary = () => {
      if (peek() === "(") { take(); const value = logicalOr(); if (take() !== ")") throw new Error(`条件式の括弧が不正です: ${expression}`); return value; }
      const token = take();
      if (token === undefined) throw new Error(`条件式が不正です: ${expression}`);
      if (/^[fisgc]\d+$/i.test(token)) return getFlag(token.toLowerCase());
      if (/^r\d+$/i.test(token)) return getRegister(Number(token.slice(1)));
      if (/^mode$/i.test(token)) return top.gameMode === "original" ? "original" : "remake";
      if (/^(original|remake)$/i.test(token)) return token.toLowerCase();
      if (/^on$/i.test(token)) return 1;
      if (/^off$/i.test(token)) return 0;
      return Number(token);
    };
    const unary = () => peek() === "!" ? (take(), !unary()) : primary();
    const compare = () => {
      const left = unary();
      const operator = peek();
      if (!["==", "!=", "<", "<=", ">", ">="].includes(operator)) return left;
      take(); const right = unary();
      return operator === "==" ? left === right : operator === "!=" ? left !== right : operator === "<" ? left < right : operator === "<=" ? left <= right : operator === ">" ? left > right : left >= right;
    };
    const logicalAnd = () => { let value = compare(); while (peek() === "&&") { take(); const right = compare(); value = Boolean(value) && Boolean(right); } return value; };
    const logicalOr = () => { let value = logicalAnd(); while (peek() === "||") { take(); const right = logicalAnd(); value = Boolean(value) || Boolean(right); } return value; };
    const result = logicalOr();
    if (cursor !== tokens.length) throw new Error(`条件式を最後まで解析できません: ${expression}`);
    return Boolean(result);
  }

  function exportScenarioState() {
    return {
      version: 1,
      scene: currentScene,
      pos: currentPos,
      sceneName: currentSceneName,
      posName: currentPositionName(),
      itemFlagSchemaVersion: 3,
      registers: registers.slice(),
      flags: Array.from({length: 100}, (_, index) => Number(top.sys.flg[index]) || 0),
      itemFlags: itemFlags.slice(),
      itemAcquisitionOrder: Array.from(itemAcquisitionOrder.entries()),
      itemAcquisitionSequence,
      layers: JSON.parse(JSON.stringify(layers)),
      music: currentMusic,
      loopingSound: currentLoopingSound
    };
  }

  function currentPositionName() {
    return scenarios.get(currentScene)?.positions.get(currentPos)?.name || "";
  }

  function importScenarioState(state) {
    importedState = state || null;
    if (scenarios.size && state) applyImportedState(state);
  }

  function applyImportedState(state) {
    if (Array.isArray(state.registers)) state.registers.slice(0, 20).forEach((value, index) => registers[index] = Math.max(0, Number(value) || 0));
    if (Array.isArray(state.flags)) state.flags.slice(0, 100).forEach((value, index) => top.sys.flg[index] = value ? 1 : 0);
    if (Number(state.itemFlagSchemaVersion) < 2 && Number(state.scene) >= 7 && Number(state.scene) <= 8) {
      const placedFlags = [92, 93, 94, 95, 97, 98];
      for (let index = 0; index < 6; index += 1) {
        if (!top.sys.flg[20 + index]) continue;
        if (Number(state.scene) === 8 && top.sys.flg[31]) top.sys.flg[placedFlags[index]] = 1;
        else top.sys.flg[80 + index] = 1;
        top.sys.flg[20 + index] = 0;
      }
    }
    itemFlags.fill(0);
    if (Array.isArray(state.itemFlags)) {
      state.itemFlags.slice(0, 100).forEach((value, index) => itemFlags[index] = value ? 1 : 0);
    } else if (Array.isArray(state.flags)) {
      legacyItemFlagNumbers.forEach((number) => itemFlags[number] = state.flags[number] ? 1 : 0);
    }
    itemAcquisitionOrder.clear();
    itemAcquisitionSequence = 0;
    if (Array.isArray(state.itemAcquisitionOrder)) {
      state.itemAcquisitionOrder.forEach((entry) => {
        if (!Array.isArray(entry)) return;
        const migratedFlag = /^f\d{1,2}$/i.test(entry[0]) ? "i" + String(Number(entry[0].slice(1))).padStart(2, "0") : entry[0];
        if (!itemDefinitions.has(migratedFlag) || getFlag(migratedFlag) !== 1) return;
        const order = Math.max(0, Number(entry[1]) || 0);
        itemAcquisitionOrder.set(migratedFlag, order);
        itemAcquisitionSequence = Math.max(itemAcquisitionSequence, order);
      });
    }
    Array.from(itemDefinitions.keys()).forEach((flag) => {
      if (getFlag(flag) === 1 && !itemAcquisitionOrder.has(flag)) itemAcquisitionOrder.set(flag, ++itemAcquisitionSequence);
    });
    if (state.layers) Object.keys(layers).forEach((key) => layers[key] = state.layers[key] || null);
    if (typeof state.music === "string") { currentMusic = state.music; top.sys.url_bgm = "---"; top.sys.bgm(state.music); }
    currentLoopingSound = typeof state.loopingSound === "string" ? state.loopingSound : "";
    if (typeof top.setLoopingScenarioSound === "function") top.setLoopingScenarioSound(currentLoopingSound);
    syncLayers();
    notifyItemInventory(false);
    importedState = null;
  }

  function resetScenarioState() {
    registers.fill(0);
    itemFlags.fill(0);
    itemAcquisitionOrder.clear();
    itemAcquisitionSequence = 0;
    Object.keys(layers).forEach((key) => layers[key] = null);
    currentMusic = "";
    currentLoopingSound = "";
    currentSoundEffectEvents = [];
    suppressSoundEffectsThrough = soundEffectSequence;
    if (typeof top.stopScenarioSounds === "function") top.stopScenarioSounds();
    presentationRevision = 0;
    pendingShakeLevel = null;
    currentScene = 0; currentPos = 0; currentSceneName = "";
    syncLayers();
    notifyItemInventory(false);
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function scenarioError(sourceName, line, message, context = {}) {
    const details = [
      "シナリオの文法・構造エラー",
      `ファイル: ${sourceName}`,
      `行番号: ${line}`
    ];
    if (context.scene !== undefined || context.pos !== undefined) {
      details.push(`場所: Scene ${context.scene ?? "?"} / pos ${context.pos ?? "?"}`);
    }
    details.push(`原因: ${message}`);
    if (context.source) details.push(`該当箇所: ${context.source}`);
    if (context.detail) details.push(`詳細: ${context.detail}`);
    if (context.hint) details.push(`修正方法: ${context.hint}`);
    return new Error(details.join("\n"));
  }
  function showRuntimeError(message) {
    console.error(message);
    top.showGameAlert(String(message), "シナリオエラー");
  }
})();
