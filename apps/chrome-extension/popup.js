const status = document.querySelector("#status");

function show(message) {
  status.textContent = message;
}

for (const button of document.querySelectorAll("button[data-kind]")) {
  button.addEventListener("click", async () => {
    for (const candidate of document.querySelectorAll("button"))
      candidate.disabled = true;
    show("Preparing capture…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "vera.capture.start",
        kind: button.dataset.kind,
      });
      if (!response?.ok)
        throw new Error(response?.error || "The capture could not be prepared");
      show("The VERA confirmation window is open.");
      setTimeout(() => window.close(), 250);
    } catch (error) {
      show(
        error instanceof Error
          ? error.message
          : "The capture could not be prepared",
      );
      for (const candidate of document.querySelectorAll("button"))
        candidate.disabled = false;
    }
  });
}
