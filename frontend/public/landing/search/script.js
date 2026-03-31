(function () {
  "use strict";

  var navToggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav-principal");

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        if (window.matchMedia("(max-width: 768px)").matches) {
          nav.classList.remove("is-open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 }
  );

  document.querySelectorAll(".reveal").forEach(function (el) {
    revealObserver.observe(el);
  });

  var flow = document.getElementById("flow-steps");
  if (flow) {
    var staggerObs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            staggerObs.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -5% 0px", threshold: 0.1 }
    );
    staggerObs.observe(flow);
  }

  var accordionRoot = document.querySelector("[data-accordion]");
  if (accordionRoot) {
    var items = accordionRoot.querySelectorAll(".faq-item");

    function setExpanded(panel, btn, open) {
      var inner = panel.querySelector(".faq-panel-inner");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      panel.style.height = open ? inner.scrollHeight + "px" : "0px";
    }

    items.forEach(function (item) {
      var btn = item.querySelector(".faq-trigger");
      var panel = item.querySelector(".faq-panel");
      if (!btn || !panel) return;

      btn.addEventListener("click", function () {
        var expanded = btn.getAttribute("aria-expanded") === "true";

        items.forEach(function (other) {
          var ob = other.querySelector(".faq-trigger");
          var op = other.querySelector(".faq-panel");
          if (other !== item && ob && op) {
            setExpanded(op, ob, false);
          }
        });

        if (expanded) {
          setExpanded(panel, btn, false);
        } else {
          setExpanded(panel, btn, true);
        }
      });
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        items.forEach(function (item) {
          var btn = item.querySelector(".faq-trigger");
          var panel = item.querySelector(".faq-panel");
          var inner = panel && panel.querySelector(".faq-panel-inner");
          if (!btn || !panel || !inner) return;
          if (btn.getAttribute("aria-expanded") === "true") {
            panel.style.height = inner.scrollHeight + "px";
          }
        });
      }, 120);
    });
  }
})();
