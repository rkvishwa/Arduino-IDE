const codeArea = document.getElementById("code");
const output = document.getElementById("output");
const compileBtn = document.getElementById("compileBtn");
const boardSelect = document.getElementById("board");
const downloadLink = document.getElementById("downloadLink");

compileBtn.addEventListener("click", async () => {
  const code = codeArea.value.trim();
  const board = boardSelect.value;

  if (!code) {
    output.textContent = "⚠️ Please paste some Arduino code first.";
    return;
  }

  output.textContent = "⏳ Compiling, please wait...";

  const result = await window.api.compileArduino({ code, board });

  if (result.success) {
    output.textContent = result.message + "\nFile: " + result.filename;
    const blob = new Blob([Uint8Array.from(atob(result.binData), c => c.charCodeAt(0))]);
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = result.filename;
    downloadLink.textContent = "⬇️ Download Compiled File";
    downloadLink.style.display = "block";
  } else {
    output.textContent = "❌ Error:\n" + result.error;
    downloadLink.style.display = "none";
  }
});
