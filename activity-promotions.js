/* Read-only campaign presentation and mouse dragging; checkout remains authoritative. */
(() => {
  'use strict';
  const track = document.querySelector('.activity-announcement__cards');
  const card = document.getElementById('activityPromotionCard');
  if (!track || !card) return;
  const offer = document.getElementById('activityPromotionOffer');
  const button = card.querySelector('button');
  const popular = track.querySelector('.activity-card--popular');
  const money = value => `$${value.toFixed(2).replace(/\.00$/, '')}`;
  let campaigns = [], timer;

  function describe(campaign, now) {
    if (!campaign?.active || (campaign.status && campaign.status !== 'published') ||
        (campaign.starts_at && !(Date.parse(campaign.starts_at) <= now)) ||
        (campaign.ends_at && !(Date.parse(campaign.ends_at) >= now))) return '';
    const amount = Number(campaign.amount), minimum = Number(campaign.threshold || 0);
    let text = '';
    if (campaign.kind === 'free_shipping') text = '配送费全免';
    else if (!Number.isFinite(amount) || amount <= 0) return '';
    else if (campaign.kind === 'full_reduction') {
      if (!Number.isFinite(minimum) || minimum < 0) return '';
      text = `满 ${money(minimum)} 减 ${money(amount)}`;
    } else if (['product_discount', 'category_discount'].includes(campaign.kind)) {
      if (campaign.discount_kind === 'percent' && amount > 100) return '';
      const scope = campaign.product_ids?.length || campaign.category_names?.length ? '指定商品 ' : '';
      text = scope + (campaign.discount_kind === 'percent' ? `${amount}% OFF` : `每件减 ${money(amount)}`);
    }
    if (text && campaign.kind === 'full_reduction' && (campaign.product_ids?.length || campaign.category_names?.length)) text = `指定商品 ${text}`;
    return text && (campaign.customer_scope === 'new' ? `新客：${text}` : text);
  }

  function render() {
    clearTimeout(timer);
    const now = Date.now();
    const offers = [...new Set(campaigns.map(campaign => describe(campaign, now)).filter(Boolean))];
    const text = offers.length ? offers.join('\n') : '敬请期待';
    if (offer.textContent !== text) offer.textContent = text;
    offer.title = offer.textContent;
    offer.tabIndex = offers.length > 1 ? 0 : -1;
    button.disabled = !offers.length;
    // Move the real DOM node so keyboard and screen-reader order matches the visual order.
    if (offers.length && card.nextElementSibling !== popular) track.insertBefore(card, popular);
    else if (!offers.length && card.nextElementSibling) track.append(card);
    // A local clock handles scheduled starts/expiry even without a new backend event.
    let delay = 60000;
    for (const campaign of campaigns) {
      for (const boundary of [Date.parse(campaign?.starts_at), Date.parse(campaign?.ends_at) + 1]) {
        if (boundary > now) delay = Math.min(delay, boundary - now);
      }
    }
    timer = setTimeout(render, Math.max(20, delay));
  }

  function connect() {
    if (!window.TingsStorefront?.subscribeCampaigns) {
      timer = setTimeout(connect, 160);
      return;
    }
    window.TingsStorefront.subscribeCampaigns(value => {
      campaigns = Array.isArray(value) ? value : [];
      render();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Array.isArray(window.TingsStorefront?.campaigns)) render();
  });
  connect();

  let drag = null, suppressClickUntil = 0;
  track.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || track.scrollWidth <= track.clientWidth) return;
    suppressClickUntil = 0;
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,scroll:track.scrollLeft,moved:false};
  });
  track.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) { drag = null; return; }
      if (Math.abs(dx) <= 6) return;
      drag.moved = true;
      track.classList.add('is-dragging');
      track.setPointerCapture(drag.id);
    }
    event.preventDefault();
    track.scrollLeft = drag.scroll - dx;
  });
  function endDrag(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const previous = drag;
    drag = null;
    if (previous.moved) suppressClickUntil = Date.now() + 350;
    track.classList.remove('is-dragging');
    if (track.hasPointerCapture(previous.id)) track.releasePointerCapture(previous.id);
  }
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  track.addEventListener('pointerleave', event => { if (!drag?.moved) endDrag(event); });
  window.addEventListener('blur', endDrag);
  track.addEventListener('dragstart', event => event.preventDefault());
  track.addEventListener('click', event => {
    if (event.detail && Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClickUntil = 0;
    }
  }, true);
})();
