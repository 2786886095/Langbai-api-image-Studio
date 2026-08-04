(() => {
  "use strict";

  window.__AI_GEN_APP_READY = false;
  window.__AI_GEN_STARTUP_ERRORS = [];

  const recordError = value => {
    const message = String(value?.message || value?.reason || value || "Unknown startup error");
    window.__AI_GEN_STARTUP_ERRORS.push(message);
    if (window.__AI_GEN_STARTUP_ERRORS.length > 10) {
      window.__AI_GEN_STARTUP_ERRORS.shift();
    }
  };

  addEventListener("error", event => recordError(event.error || event.message));
  addEventListener("unhandledrejection", event => recordError(event.reason));

  const showFallbackModal = modal => {
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
  };

  const hideFallbackModal = modal => {
    if (!modal) return;
    modal.classList.add("hidden");
    if (!document.querySelector(".modal:not(.hidden), .lightbox")) {
      document.body.classList.remove("modal-open");
    }
  };

  // These controls remain usable even if app.js aborts while restoring a bad
  // saved state. Normal app listeners take over as soon as APP_READY is true.
  document.addEventListener("click", event => {
    if (window.__AI_GEN_APP_READY === true) return;
    const target = event.target?.closest?.("button, [role='button']");
    if (!target) return;

    if (target.id === "settingsBtn") {
      event.preventDefault();
      showFallbackModal(document.querySelector("#settingsModal"));
      return;
    }
    if (target.id === "skillsBtn" || target.id === "openSkillsFromPanel") {
      event.preventDefault();
      showFallbackModal(document.querySelector("#skillsModal"));
      return;
    }
    if (target.id === "closeSkills") {
      event.preventDefault();
      hideFallbackModal(document.querySelector("#skillsModal"));
      return;
    }
    if (target.id === "closeSettings") {
      event.preventDefault();
      hideFallbackModal(document.querySelector("#settingsModal"));
      return;
    }
    if (target.matches(".mode-tab[data-mode]")) {
      event.preventDefault();
      const mode = target.dataset.mode;
      document.querySelectorAll(".mode-tab[data-mode]").forEach(tab => {
        const active = tab === target;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelector("#comicPanelSection")?.classList.toggle("hidden", mode !== "comic");
      document.querySelector("#turnaroundSection")?.classList.toggle("hidden", mode !== "turnaround");
      document.querySelector("#nImagesField")?.classList.toggle("hidden", mode !== "single");
      document.querySelector("#globalPromptField")?.classList.toggle("hidden", mode === "turnaround");
      document.querySelector("#activeSkillsSection")?.classList.toggle("hidden", mode === "turnaround");
    }
  }, true);

  setTimeout(() => {
    if (window.__AI_GEN_APP_READY === true) return;
    const status = document.querySelector("#status");
    if (!status) return;
    const details = window.__AI_GEN_STARTUP_ERRORS.at(-1);
    status.textContent = details
      ? `程序初始化失败：${details}`
      : "程序初始化超时，请重启软件或清理损坏的本地状态。";
    status.classList.remove("hidden", "success");
    status.classList.add("error");
  }, 5000);
})();
