(() => {
  const config = window.SELIGAMEN_CONFIG || {};

  function wireLink(id, url, missingMessage) {
    const el = document.getElementById(id);
    if (!el) return;
    if (url) {
      el.href = url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      return;
    }
    el.href = "#";
    el.addEventListener("click", (event) => {
      event.preventDefault();
      window.alert(missingMessage);
    });
  }

  wireLink("whatsapp-main", config.whatsappGroupUrl, "O link do grupo será liberado em breve.");
  wireLink("whatsapp-bottom", config.whatsappGroupUrl, "O link do grupo será liberado em breve.");

  const instagram = document.getElementById("instagram-link");
  const tiktok = document.getElementById("tiktok-link");
  if (instagram) instagram.hidden = !config.instagramUrl;
  if (tiktok) tiktok.hidden = !config.tiktokUrl;
  wireLink("instagram-link", config.instagramUrl, "Instagram em breve.");
  wireLink("tiktok-link", config.tiktokUrl, "TikTok em breve.");

  document.querySelectorAll("[data-category]").forEach((card) => {
    card.addEventListener("click", () => {
      document.getElementById("whatsapp-main")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
