export async function renderClaidTrial(api,page,image,trial){
 const panel=page.querySelector('.editor-controls');
 panel.innerHTML='<h2>Private Claid test</h2><p id="trial-summary" class="help"></p><form id="claid-trial-form"><label>Operation<select name="operation"><option value="enhance">Improve lighting and colour · keep the original background</option></select></label><p class="help">Claid will process this same photograph at its original dimensions. Review faces, textures and product details in the result. No generative scene or face reconstruction is requested.</p><p class="help">Claid temporarily hosts the result for up to 24 hours before it is copied into your private image library.</p><label class="check-row"><input name="consent" type="checkbox" required><span>I have permission to edit this photograph and send it to Claid for this test.</span></label><div id="claid-trial-notice" class="notice" role="status"></div><button type="submit" disabled>Enhance photograph with Claid</button></form><section id="claid-trial-result" hidden><h3>Claid result</h3><img id="claid-trial-photo" alt="Claid processed version of your original photograph" style="display:block;width:100%;height:auto"><p><a id="claid-trial-download">Download result</a> · <a href="/app/library">Open image library</a></p><p class="help">Your original is unchanged. Compare both photographs before approving this operation.</p></section><button id="claid-trial-recover" type="button" hidden>Recover existing result · no new processing</button>';
 const form=panel.querySelector('form'),button=form.querySelector('button'),notice=panel.querySelector('#claid-trial-notice'),recover=panel.querySelector('#claid-trial-recover');
 const requested=new URLSearchParams(location.search).get('mode');
 const mode=['personal','portrait','product'].includes(requested)?requested:'personal';
 if(mode==='product'){const o=document.createElement('option');o.value='product_finish';o.textContent='Product lighting and white background';form.elements.operation.append(o);form.elements.operation.value='product_finish';}
 let busy=false,submission=null,job=null,locked=false;
 if(trial.configuration_required)notice.textContent=trial.message;
 const key=`sonkoflow-claid-trial:${image.id}`;
 try{submission=sessionStorage.getItem(key)}catch{}
 panel.querySelector('#trial-summary').textContent=`Only your account can use this trial. ${trial.remaining_requests} request(s) remain, with 3 Claid API credits reserved per request and a maximum trial allowance of ${trial.max_trial_credits} credits. Subscription credits are unchanged.`;
 function enabled(){button.disabled=busy||!trial.enabled||!form.elements.consent.checked;form.elements.operation.disabled=busy||locked;}
 function show(j){
  job=j;notice.textContent=j.status==='running'?'Claid is processing your photograph…':j.message;
  recover.hidden=!j.can_recover;
  if(j.status==='completed'&&j.output_image_id){panel.querySelector('#claid-trial-result').hidden=false;panel.querySelector('#claid-trial-photo').src=`/api/images/${j.output_image_id}/content`;const a=panel.querySelector('#claid-trial-download');a.href=`/api/images/${j.output_image_id}/content?download=1`;a.download='claid-result.webp';}
 }
 async function poll(j){
  show(j);
  for(let n=0;n<245&&page.isConnected&&['running','persisting'].includes(j.status);n++){
   await new Promise(r=>setTimeout(r,1500));if(!page.isConnected)return;
   const out=await api(`/claid-trial/jobs/${j.id}`);j=out.job;show(j);
  }
  if(['completed','failed','uncertain'].includes(j.status)){submission=null;try{sessionStorage.removeItem(key)}catch{};locked=false;}
  const caps=await api('/processing/capabilities');if(caps.claid_trial)trial=caps.claid_trial;
 }
 form.elements.consent.addEventListener('change',enabled);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!trial.enabled||!form.elements.consent.checked)return;
  if(!submission&&!confirm('Run one private Claid test? This reserves up to 3 API trial credits and one trial slot. Your original will be preserved.'))return;
  submission??=crypto.randomUUID();try{sessionStorage.setItem(key,submission)}catch{}
  busy=true;locked=true;enabled();notice.textContent='Submitting to Claid…';
  try{const out=await api('/claid-trial/jobs',{method:'POST',body:JSON.stringify({project_id:image.project_id,input_image_id:image.id,submission_key:submission,mode,operation:form.elements.operation.value,provider_consent:true})});await poll(out.job);}
  catch(error){notice.textContent=`${error.message} The submission identifier is retained. Retry only this unchanged submission; do not create another edit.`;button.textContent='Check this submission';}
  finally{busy=false;enabled();}
 });
 recover.addEventListener('click',async()=>{if(busy||!job)return;busy=true;recover.disabled=true;enabled();try{const out=await api(`/claid-trial/jobs/${job.id}/recover`,{method:'POST',body:'{}'});await poll({...out.job,status:'persisting'});}catch(e){notice.textContent=e.message}finally{busy=false;recover.disabled=false;enabled();}});
 const prior=trial.jobs?.filter(j=>j.input_image_id===image.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
 if(prior){show(prior);if(['running','persisting'].includes(prior.status)){busy=true;enabled();poll(prior).catch(e=>{notice.textContent=e.message}).finally(()=>{busy=false;enabled()});}}
 enabled();
}
