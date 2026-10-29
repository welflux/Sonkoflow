import './billing-overview.css';
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Not available';
const bytes=value=>value>=1048576?`${(value/1048576).toFixed(1)} MB`:`${Math.round(value/1024)} KB`;
function paymentState(receipt){return receipt.refunded_cents>=receipt.amount_cents && receipt.refunded_cents>0?'Refunded':receipt.refunded_cents>0?'Partially refunded':'Verified';}
function csvCell(value){let text=String(value);if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export async function billingOverviewPage(api,shell){
 const page=shell('billing');page.classList.add('billing-page');
 page.innerHTML=`<header class="page-heading billing-heading"><div><p class="eyebrow">WORKSPACE RESOURCES</p><h1>Plan & usage</h1><p>Your allowance, storage and verified billing records in one place.</p></div><div class="billing-heading-actions"><button type="button" class="secondary" id="refresh-billing">Refresh usage</button><a class="button" href="/pricing#plans">View plans</a></div></header>
 <div id="page-notice" class="notice"></div><div id="billing-notice" class="billing-banner" role="status" hidden></div>
 <div class="billing-dashboard"><div class="billing-resources"><section class="billing-card" id="billing-balance" aria-labelledby="allowance-heading"><div class="billing-card-top"><h2 id="allowance-heading">Processing allowance</h2><span class="billing-micro">PREPAID UNITS</span></div><div id="allowance-content"><p>Loading your balance…</p></div></section>
 <section class="billing-card" aria-labelledby="storage-heading"><div class="billing-card-top"><h2 id="storage-heading">Storage & collections</h2><a href="/app/library">Manage library ↗</a></div><div id="storage-content"><p>Loading workspace usage…</p></div></section>
 <section class="billing-activity" aria-label="Workspace activity"><a href="/app/library"><span>Completed edits</span><strong id="completed-edits">—</strong><small>All time · view library ↗</small></a><a href="/app/batches"><span>Bulk requests</span><strong id="bulk-requests">—</strong><small>All time · open bulk processing ↗</small></a><a href="/app/brands"><span>Brand profiles</span><strong id="brand-profiles">—</strong><small>Stored · open Brand Studio ↗</small></a></section></div>
 <aside class="billing-card billing-subscription" aria-labelledby="subscription-heading"><span class="billing-micro">SUBSCRIPTION</span><h2 id="subscription-heading">Your current plan</h2><div id="billing-subscriptions"><p>Loading subscription details…</p></div><a class="button" href="/pricing#plans">Compare plans</a><div class="billing-subscription-note"><strong>Controlled spending</strong><p>No automatic usage top-ups. Each generation requires an estimate and an allowance reservation.</p><a href="/app/profile">Account & sign-in details ↗</a></div></aside></div>
 <section class="billing-card billing-payments" aria-labelledby="payments-heading"><div class="billing-card-top"><div><h2 id="payments-heading">Verified payments</h2><p>Payment records appear after server verification.</p></div><button type="button" class="secondary" id="export-payments" disabled>Export CSV</button></div><div id="billing-receipts"><p>Loading payment records…</p></div><p class="billing-footnote">Amounts are in USD. These are payment records, not tax invoices. Payment approval is handled securely by PayPal.</p></section>
 <footer class="billing-page-footer"><p>Units are processing allowance, not an image count or cash balance. Purchased units remain in your balance; your verified billing period controls paid feature access.</p><a href="/pricing#usage">How processing units work ↗</a><span id="billing-updated"></span></footer>`;
 const notice=page.querySelector('#billing-notice');
 function announce(text){notice.textContent=text;notice.hidden=!text;}
 function meter(container,label,used,total,format=String){
  const block=el('div',undefined,'billing-meter');const caption=el('div',undefined,'billing-meter-caption');caption.append(el('span',label),el('strong',`${format(used)} / ${format(total)}`));
  const progress=el('progress');progress.max=Math.max(1,total);progress.value=Math.min(Math.max(0,used),Math.max(1,total));progress.setAttribute('aria-label',`${label}: ${format(used)} of ${format(total)}`);block.append(caption,progress);container.append(block);
 }
 async function load(){
  const refresh=page.querySelector('#refresh-billing');refresh.disabled=true;page.setAttribute('aria-busy','true');announce('');
  try{
   const data=await api('/billing/overview');const account=data.account;const available=account.balance_credits-account.reserved_credits;
   if(!data.purchasing_enabled)announce('Purchasing is awaiting activation. You can still manage your photographs and review recorded workspace usage. No payment is taken here.');
   else if(available<0)announce('Your balance has a deficit after a usage or payment adjustment. New processing is paused until it is resolved.');
   else if(available<20)announce('Your processing allowance is running low. Review the estimate before starting an edit or compare available plans.');
   const balance=page.querySelector('#allowance-content');balance.replaceChildren();
   const amount=el('div',undefined,'billing-allowance-value');amount.append(el('strong',available.toLocaleString()),el('span',' available units'));balance.append(amount);
   const stats=el('div',undefined,'billing-allowance-stats');
   for(const [label,value] of [['Current balance',account.balance_credits],['Reserved for work',account.reserved_credits]]){const item=el('div');item.append(el('span',label),el('strong',value.toLocaleString()));stats.append(item);}balance.append(stats);
   meter(balance,'Reserved share of current balance',account.reserved_credits,Math.max(0,account.balance_credits),value=>`${value} units`);
   balance.append(el('p',data.allowance_recorded?'Reservations hold units while processing runs. This is your current balance, not a monthly consumption limit.':'No processing allowance has been recorded for this account yet.','billing-footnote'));
   const storage=page.querySelector('#storage-content');storage.replaceChildren();meter(storage,'Storage allocated',data.usage.storage_bytes,data.limits.storage_bytes,bytes);meter(storage,'Images stored',data.usage.images,data.limits.images);meter(storage,'Projects stored',data.usage.projects,data.limits.projects);
   storage.append(el('p','Storage includes originals, generated images and items in Trash until permanent removal. Archived projects count toward your project limit.','billing-footnote'));
   for(const [selector,value] of [['#completed-edits',data.usage.completed_edits],['#bulk-requests',data.usage.bulk_requests],['#brand-profiles',data.usage.brand_profiles]])page.querySelector(selector).textContent=value.toLocaleString();
   const subscription=page.querySelector('#billing-subscriptions');subscription.replaceChildren();
   const names={free:'Free',starter:'Starter',pro:'Pro',payg:'Pay as you go'};
   subscription.append(el('span',names[data.plan]??'Account plan','billing-tier'));
   if(!data.subscriptions.length)subscription.append(el('p',data.purchasing_enabled?'No recurring subscription. Compare plans when you need more room to create.':'No recurring subscription is recorded for this account.','billing-subscription-copy'));
   for(const sub of data.subscriptions){
    const card=el('article',undefined,'billing-subscription-record');card.append(el('strong',names[sub.plan]??sub.plan));
    const terms=el('dl');
    for(const [label,value] of [['Status',({active:'Active',cancelled:'Renewal cancelled',suspended:'Suspended',failed:'Payment failed',refunded:'Refunded'})[sub.state]??sub.state],['Billing cycle',sub.interval==='year'?'Yearly':sub.interval==='month'?'Monthly':'Not recorded'],['Paid through',date(sub.paid_until)],['Recurring price',sub.amount_cents===null?'Not recorded':`${money(sub.amount_cents)} / ${sub.interval==='year'?'year':'month'}`]]){const row=el('div');row.append(el('dt',label),el('dd',value));terms.append(row);}card.append(terms);
    if(['active','suspended','failed'].includes(sub.state)){
     const cancel=el('button','Cancel future renewal','secondary');cancel.type='button';cancel.onclick=async()=>{if(!confirm('Stop future subscription renewals? Your verified paid period and previously granted units are retained.'))return;cancel.disabled=true;try{await api(`/billing/subscriptions/${encodeURIComponent(sub.provider_id)}/cancel`,{method:'POST',body:'{}'});await load();}catch(error){announce(error.message);cancel.disabled=false;}};card.append(cancel);
    }subscription.append(card);
   }
   const payments=page.querySelector('#billing-receipts');payments.replaceChildren();
   const exportButton=page.querySelector('#export-payments');exportButton.disabled=!data.receipts.length;
   if(data.receipts.length){
    const wrap=el('div',undefined,'billing-table-wrap');const table=el('table');const thead=el('thead');const tr=el('tr');for(const title of ['Date','Payment reference','Allowance','Amount (USD)','Status']){const th=el('th',title);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);const tbody=el('tbody');
    for(const receipt of data.receipts){const row=el('tr');row.append(el('td',date(receipt.created_at)),el('td',receipt.payment_id,'billing-reference'),el('td',`${receipt.units.toLocaleString()} processing units`),el('td',money(receipt.amount_cents)));const status=el('td');status.append(el('span',paymentState(receipt),'billing-payment-state'));if(receipt.refunded_cents)status.append(el('small',`${money(receipt.refunded_cents)} refunded`));row.append(status);tbody.append(row);}table.append(tbody);wrap.append(table);payments.append(wrap);
    if(data.receipts.length===50)payments.append(el('p','Showing the latest 50 verified payment records. CSV export contains these records.','billing-footnote'));
    exportButton.onclick=()=>{const rows=[['Date','Payment reference','Processing units','Amount USD','Refunded USD','Status'],...data.receipts.map(r=>[r.created_at,r.payment_id,r.units,(r.amount_cents/100).toFixed(2),(r.refunded_cents/100).toFixed(2),paymentState(r)])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download='sonkoflow-payment-records.csv';document.body.append(link);link.click();link.remove();exportButton.focus({preventScroll:true});setTimeout(()=>URL.revokeObjectURL(url),1000);};
   }else{
    const empty=el('div',undefined,'billing-empty');empty.append(el('span','↗','billing-empty-icon'),el('strong','No verified payments yet'),el('p','Completed payments will appear here with their reference, amount and any refunds.'));const link=el('a','Review available plans');link.href='/pricing#plans';empty.append(link);payments.append(empty);exportButton.onclick=null;
   }
   page.querySelector('#billing-updated').textContent=`Updated ${new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){
   announce(error.message||'Billing information could not load. Refresh to try again.');
   for(const selector of ['#allowance-content','#storage-content','#billing-subscriptions','#billing-receipts']){const target=page.querySelector(selector);target.replaceChildren(el('p','Records are temporarily unavailable. Use Refresh usage to try again.','billing-unavailable'));}
   for(const selector of ['#completed-edits','#bulk-requests','#brand-profiles'])page.querySelector(selector).textContent='—';
   page.querySelector('#export-payments').disabled=true;page.querySelector('#billing-updated').textContent='';
  }finally{refresh.disabled=false;page.removeAttribute('aria-busy');}
 }
 page.querySelector('#refresh-billing').onclick=load;await load();
}
