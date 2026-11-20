(function () {
  "use strict";

  let replacements = [];

  function replaceAllLiteral(value, from, to) {
    return value.split(from).join(to);
  }

  function parseOsakaData(source) {
    return String(source || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line && !line.trimStart().startsWith("#"))
      .map((line, index) => {
        const separator = line.indexOf("\t");
        if (separator < 0) throw new Error(`osaka.txtの${index + 1}行目にタブ区切りがありません。`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
      .filter(([from]) => from);
  }

  window.osakaDataReady = fetch("scenario/osaka.txt", {cache: "no-store"})
    .then((response) => {
      if (!response.ok) throw new Error(`osaka.txtを読み込めませんでした (HTTP ${response.status})`);
      return response.text();
    })
    .then((source) => {
      replacements = parseOsakaData(source);
      return replacements.length;
    })
    .catch((error) => {
      replacements = [];
      console.error("大阪弁変換テーブルの読み込みに失敗しました。", error);
      throw error;
    });

  window.changeOsakaText = function changeOsakaText(value) {
    let result = String(value ?? "");
    for (const [from, to] of replacements) result = replaceAllLiteral(result, from, to);
    return result;
  };
})();
