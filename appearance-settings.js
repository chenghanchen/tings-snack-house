/* Split public-site presentation controls from operational store settings. */
(()=>{
  const $=selector=>document.querySelector(selector);
  const contentDefaults={heroEyebrow:'今日の小さなごほうび',heroTitle:'把喜欢的零食，',heroEmphasis:'装进日常里。',heroIntro:'从童年味道到新鲜人气款，挑一袋让心情变好的中国零食。下单即为您预留，无需在线付款。',heroButton:'开始挑选',footerHours:'营业时间：每日 10:00 – 21:00',footerYear:'2026'};
  const deliveryDefaults={deliveryEyebrow:'LOCAL DELIVERY',deliveryTitle:'把零食送到你身边',deliveryStampTop:'DELIVERY',deliveryStampBottom:'CHICAGO',deliveryBackgroundColor:'#f4e9d2'};
  const imageKeys=['heroBackgroundImage','storyBackgroundImage','deliveryStampImage','deliveryBackgroundImage'];
  const toast=message=>{const node=$('#toast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2800);};
  const inputValue=(id,fallback)=>$(id)?.value.trim()||fallback;

  function ensureShell(){
    const nav=$('aside nav'),settingsButton=$('[data-view="settings"]'),settings=$('#settings');
    if(!nav||!settingsButton||!settings)return false;
    settingsButton.textContent='店铺设置';
    if(!$('[data-view="appearance"]')){
      settingsButton.insertAdjacentHTML('afterend','<button data-view="appearance">店铺外观</button>');
      settings.insertAdjacentHTML('afterend','<section class="view" id="appearance"><div class="panel narrow appearance-panel"><h2>店铺外观</h2><p class="muted">管理顾客网站的首页、配送区域和页尾文案、插画与背景图片。</p><form id="appearanceForm"><div id="appearanceFields"><p class="muted">正在加载外观设置…</p></div><button class="primary" type="submit">保存店铺外观</button></form></div></section>');
      $('[data-view="appearance"]').addEventListener('click',()=>{document.querySelectorAll('aside nav button,.view').forEach(node=>node.classList.remove('active'));$('[data-view="appearance"]').classList.add('active');$('#appearance')?.classList.add('active');$('#pageTitle').textContent='店铺外观';});
    }
    return true;
  }

  function moveAppearanceFields(){
    const source=$('#settingsForm'),target=$('#appearanceFields');
    const sections=['heroContentSettings','deliveryContentSettings','footerContentSettings','imageSettings'].map(id=>$('#'+id));
    if(!source||!target||sections.some(section=>!section))return false;
    if(!target.dataset.moved){
      sections.forEach(section=>target.append(section));
      source.querySelectorAll(':scope > hr').forEach(rule=>rule.remove());
      target.dataset.moved='true';
    }
    return true;
  }

  async function saveAppearance(event){
    event.preventDefault();
    const source=$('#settingsForm');
    if(!source||!window.supabase||!window.TINGS_SUPABASE)return;
    const content={};
    Object.entries(contentDefaults).forEach(([key,fallback])=>{content[key]=inputValue('#'+key+'Input',fallback);});
    Object.entries(deliveryDefaults).forEach(([key,fallback])=>{content[key]=inputValue('#'+key+'Input',fallback);});
    imageKeys.forEach(key=>{content[key]=source.dataset[key]||'';});
    const fee=Number($('#deliveryFeeInput')?.value||5),free=Number($('#freeDeliveryInput')?.value||50),delivery=inputValue('#deliveryText',`配送费 $${fee.toFixed(2)}；商品小计满 $${free.toFixed(2)} 免费配送。`);
    const db=window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey);
    const {data:current}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle();
    const {error}=await db.from('shop_settings').update({delivery,content:{...(current?.content||{}),...content},updated_at:new Date().toISOString()}).eq('id',1);
    toast(error?error.message:'店铺外观已保存');
  }

  function bindAppearanceForm(){
    const form=$('#appearanceForm');
    if(!form||form.dataset.bound)return;
    form.dataset.bound='true';
    form.addEventListener('submit',saveAppearance);
  }

  function setup(){
    if(!ensureShell())return setTimeout(setup,150);
    if(!moveAppearanceFields())return setTimeout(setup,180);
    bindAppearanceForm();
  }

  window.addEventListener('load',()=>setTimeout(setup,220));
})();
