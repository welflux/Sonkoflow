import './profile.css';
const text = (node, value) => { node.textContent = value; };
export async function profilePage({api, shell, profile, onProfile, message}) {
  const page = shell('profile');
  page.classList.add('account-page');
  page.innerHTML = `
    <header class="account-heading"><p class="eyebrow">YOUR WORKSPACE, YOUR DETAILS</p><h1>Profile & account</h1><p>A few personal details. A clear view of your account.</p></header>
    <div id="page-notice" class="notice"></div>
    <section class="account-overview" aria-label="Profile overview"><div class="account-avatar" aria-hidden="true"></div><div class="account-overview-copy"><span class="account-kicker">YOUR SONKOFLOW ACCOUNT</span><h2 id="account-name"></h2><p id="account-email">Loading your account details…</p></div><a class="account-overview-link" href="#account-security">Review sign-in & security <span aria-hidden="true">↗</span></a></section>
    <div class="account-columns"><div class="account-primary">
      <section class="account-card" aria-labelledby="profile-heading"><header class="account-card-heading"><span class="account-section-number">01</span><div><h2 id="profile-heading">Personal profile</h2><p>How you appear in your private workspace.</p></div></header>
        <form id="personal-profile"><fieldset><div class="account-field-grid"><label>Display name<input name="display_name" maxlength="100" autocomplete="name" placeholder="Your full name"></label><label>Primary workflow<select name="audience"><option value="ecommerce">E-commerce products</option><option value="professional">Professional imagery</option><option value="individual">Personal photographs</option></select></label></div><p class="account-field-note">Your workflow sets the starting point for new projects. You can choose a different direction for each project.</p><div class="account-form-actions"><button type="submit">Save profile</button><button type="button" class="secondary account-cancel">Cancel</button></div></fieldset><div class="notice"></div></form>
      </section>
      <section class="account-card" aria-labelledby="work-heading"><header class="account-card-heading"><span class="account-section-number">02</span><div><h2 id="work-heading">About your work</h2><p>A little context, kept with your account.</p></div></header>
        <form id="work-profile"><fieldset disabled><div class="account-field-grid"><label>Job title <span class="account-optional">Optional</span><input name="job_title" maxlength="100" autocomplete="organization-title" placeholder="e.g. Product photographer"></label><label>Location <span class="account-optional">Optional</span><input name="location" maxlength="100" autocomplete="address-level2" placeholder="e.g. Cape Town, South Africa"></label><label class="account-field-wide">Time zone<select name="time_zone"></select><span class="account-field-note">Used for the session dates shown on this page.</span></label></div><div class="account-form-actions"><button type="submit">Save work details</button><button type="button" class="secondary account-cancel">Cancel</button></div></fieldset><div class="notice"></div></form>
      </section>
      <section class="account-card" aria-labelledby="sessions-heading"><header class="account-card-heading"><span class="account-section-number">03</span><div><h2 id="sessions-heading">Workspace sessions</h2><p>Review your active sign-ins and close sessions you no longer need.</p></div></header><div id="account-sessions"><p>Loading active sessions…</p></div><div class="account-session-actions"><button type="button" class="secondary" id="revoke-sessions" disabled>Sign out other sessions</button></div><div id="session-notice" class="notice"></div><p class="account-field-note">Only SonkoFlow sessions are shown. Device and location tracking is not collected for this list.</p></section>
    </div><aside class="account-secondary">
      <section class="account-card account-security" id="account-security" aria-labelledby="security-heading"><span class="account-kicker">ACCOUNT & SECURITY</span><h2 id="security-heading">Your sign-in details</h2><dl class="account-facts"><div><dt>Email address</dt><dd id="security-email">Loading…</dd><dd class="account-verification" id="email-verification"></dd></div><div><dt>Connected sign-in methods</dt><dd id="account-providers">Loading…</dd></div><div><dt>Member since</dt><dd id="account-created">—</dd></div></dl><div class="account-password"><h3>Password access</h3><p>Receive a secure email link to set or update your password.</p><button type="button" class="secondary" id="account-recovery" disabled>Send password reset link</button><div id="recovery-notice" class="notice"></div></div></section>
      <section class="account-card account-plan" aria-labelledby="account-plan-heading"><span class="account-kicker">YOUR ROOM TO CREATE</span><h2 id="account-plan-heading">Plan & allowance</h2><div id="account-plan-summary"><p>Loading your plan…</p></div><a class="account-inline-link" href="/app/billing">Manage plan & billing <span aria-hidden="true">↗</span></a><p class="account-field-note">Subscription status, verified payments and billing history live in Plan & usage.</p></section>
      <section class="account-privacy"><span aria-hidden="true">↗</span><div><h2>Your private workspace</h2><p>Your photographs stay associated with your account. Review how your information is handled.</p><a href="/privacy">Privacy policy</a></div></section>
    </aside></div>`;
  let account;
  let savedDetails;
  const personal = page.querySelector('#personal-profile');
  const work = page.querySelector('#work-profile');
  const initials = name => (name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('') || 'SF').toUpperCase();
  function updateOverview() {
    text(page.querySelector('#account-name'), profile.display_name || 'Your creative workspace');
    text(page.querySelector('.account-avatar'), initials(profile.display_name));
  }
  function fill(form, values) { for (const [key,value] of Object.entries(values)) if(form.elements.namedItem(key)) form.elements.namedItem(key).value=value; }
  function resetPersonal() { fill(personal, profile); }
  updateOverview(); resetPersonal();
  const zones = ['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])];
  const zoneSelect = work.elements.namedItem('time_zone');
  for(const zone of zones) { const option=document.createElement('option');option.value=zone;option.textContent=zone.replaceAll('_',' ');zoneSelect.append(option); }
  function date(value) {
    if(!value || !Number.isFinite(Date.parse(value))) return 'Not available';
    return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:savedDetails?.time_zone || 'UTC'}).format(new Date(value));
  }
  function renderSessions() {
    const container=page.querySelector('#account-sessions');container.replaceChildren();
    for(const session of account.sessions) {
      const item=document.createElement('article');item.className='account-session';
      const heading=document.createElement('div');heading.className='account-session-title';
      const title=document.createElement('strong');title.textContent=session.current?'This session':'Workspace session';heading.append(title);
      if(session.current) {const tag=document.createElement('span');tag.className='account-current';tag.textContent='Current';heading.append(tag);}
      const started=document.createElement('p');started.textContent=`Signed in ${date(session.created_at)}`;
      const expiry=document.createElement('small');expiry.textContent=`Expires ${date(session.expires_at)}`;
      item.append(heading,started,expiry);container.append(item);
    }
    if(!account.sessions.length) {const p=document.createElement('p');p.textContent='No active sessions were returned. Refresh to check again.';container.append(p);}
    page.querySelector('#revoke-sessions').disabled=!account.sessions.some(session=>!session.current);
  }
  function bindAccountForm(form, save, cancel) {
    const notice=form.querySelector('.notice');const fieldset=form.querySelector('fieldset');
    form.querySelector('.account-cancel').onclick=()=>{if(form.getAttribute('aria-busy')==='true')return;cancel();notice.textContent='';};
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(form.getAttribute('aria-busy')==='true')return;
      const values=Object.fromEntries(new FormData(form));
      form.setAttribute('aria-busy','true');fieldset.disabled=true;notice.textContent='';
      try{await save(values,notice);}catch(error){message(notice,error.message,true);}
      finally{fieldset.disabled=false;form.removeAttribute('aria-busy');}
    });
  }
  bindAccountForm(personal,async(values,notice)=>{
    const result=await api('/profile',{method:'PATCH',body:JSON.stringify(values)});profile=result.profile;onProfile(profile);updateOverview();resetPersonal();message(notice,'Your profile has been saved.');
  },resetPersonal);
  bindAccountForm(work,async(values,notice)=>{
    const result=await api('/account/details',{method:'PATCH',body:JSON.stringify(values)});savedDetails=result.details;fill(work,savedDetails);renderSessions();message(notice,'Your work details have been saved.');
  },()=>fill(work,savedDetails));
  const loaded=await Promise.allSettled([api('/account'),api('/billing/account')]);
  if(loaded[0].status==='fulfilled' && loaded[0].value.account) {
    account=loaded[0].value.account;savedDetails=account.details;
    if(!zones.includes(savedDetails.time_zone)){const option=document.createElement('option');option.value=savedDetails.time_zone;option.textContent=savedDetails.time_zone.replaceAll('_',' ');zoneSelect.append(option);}
    fill(work,savedDetails);work.querySelector('fieldset').disabled=false;
    text(page.querySelector('#account-email'),account.email);
    text(page.querySelector('#security-email'),account.email);
    text(page.querySelector('#email-verification'),account.email_verified?'✓ Verified email':'Email not verified');
    text(page.querySelector('#account-providers'),account.providers.map(p=>p==='google'?'Google':p==='email'?'Email & password':p).join(' · ') || 'No sign-in methods returned');
    text(page.querySelector('#account-created'),date(account.created_at));renderSessions();
    const recovery=page.querySelector('#account-recovery');recovery.disabled=!account.email_verified;
    recovery.onclick=async()=>{recovery.disabled=true;const notice=page.querySelector('#recovery-notice');try{const result=await api('/auth/recover',{method:'POST',body:JSON.stringify({email:account.email})});message(notice,result.message);}catch(error){message(notice,error.message,true);}finally{recovery.disabled=false;}};
    page.querySelector('#revoke-sessions').onclick=()=>{
      const dialog=document.createElement('dialog');dialog.className='account-confirm';
      dialog.innerHTML='<form method="dialog"><h2>Sign out other sessions?</h2><p>Your current session stays open. Other SonkoFlow sessions will need to sign in again.</p><div class="account-form-actions"><button value="confirm">Sign out others</button><button value="cancel" class="secondary" autofocus>Keep sessions</button></div></form>';
      const trigger=page.querySelector('#revoke-sessions');
      dialog.addEventListener('close',async()=>{const confirmed=dialog.returnValue==='confirm';dialog.remove();trigger.focus();if(!confirmed)return;trigger.disabled=true;try{await api('/account/sessions/revoke-others',{method:'POST',body:'{}'});account.sessions=account.sessions.filter(session=>session.current);renderSessions();message(page.querySelector('#session-notice'),'Other workspace sessions have been signed out.');}catch(error){message(page.querySelector('#session-notice'),error.message,true);trigger.disabled=false;}});
      document.body.append(dialog);dialog.showModal();
    };
  } else {
    message(page.querySelector('#page-notice'),'Account security details could not load. Refresh to try again. Your profile is still available.',true);
    for(const selector of ['#account-email','#security-email','#account-providers','#account-sessions'])text(page.querySelector(selector),'Details currently unavailable.');
  }
  const summary=page.querySelector('#account-plan-summary');summary.replaceChildren();
  if(loaded[1].status==='fulfilled' && loaded[1].value.account) {
    const billing=loaded[1].value;const name=document.createElement('strong');name.className='account-plan-name';name.textContent=({free:'Free',starter:'Starter',pro:'Pro',payg:'Pay as you go'})[billing.plan] || 'Account plan';
    const balance=document.createElement('p');balance.textContent=`${(billing.account.balance_credits-billing.account.reserved_credits).toLocaleString()} processing units available`;
    const state=document.createElement('small');state.textContent=billing.subscriptions?.some(sub=>sub.state==='active')?'Verified subscription active':'No active subscription';
    summary.append(name,balance,state);
  }else {
    const p=document.createElement('p');
    p.textContent=loaded[1].status==='rejected' && loaded[1].reason.code==='billing_not_ready'
      ? 'Purchasing is awaiting activation. Explore the available plans while your workspace stays accessible.'
      : 'Plan details are currently unavailable. Open Plan & usage to try again.';
    summary.append(p);
  }
}
