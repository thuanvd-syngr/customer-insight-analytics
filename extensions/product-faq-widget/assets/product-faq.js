// Product FAQ App Block — accordion interaction
(function () {
  'use strict';

  function initFaqBlock(block) {
    var useAccordion = block.getAttribute('data-accordion') === 'true';
    var buttons = block.querySelectorAll('.cia-faq-q');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        var answerId = btn.getAttribute('aria-controls');
        var answer = document.getElementById(answerId);

        if (useAccordion) {
          // Close all others in this block
          buttons.forEach(function (other) {
            if (other !== btn) {
              other.setAttribute('aria-expanded', 'false');
              var otherId = other.getAttribute('aria-controls');
              var otherAnswer = document.getElementById(otherId);
              if (otherAnswer) otherAnswer.hidden = true;
            }
          });
        }

        var next = !expanded;
        btn.setAttribute('aria-expanded', String(next));
        if (answer) answer.hidden = !next;
      });
    });
  }

  function init() {
    document.querySelectorAll('.cia-faq-block').forEach(initFaqBlock);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
