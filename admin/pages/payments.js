import {escapeHtml as e,money,showDetails,statusIndicator} from '../components.js?v=3';
import {db,grid} from '../backend-ui.js';

const label={awaiting_payment:'Awaiting Payment',verification_pending:'Verification Pending',paid:'Paid',rejected:'Rejected'};
const tone={awaiting_payment:'neutral',verification_pending:'warning',paid:'success',rejected:'danger'};
const phTime=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';

export async function renderOrderPayments(content,orders,refreshOrders){
  const panel=content.querySelector('#order-payments');
  if(!panel)return;
  try{
    const [payments,methods]=await Promise.all([
      db.client.from('order_payment_attempts').select('*').order('created_at',{ascending:false}).limit(100).then(db.unwrap),
      db.client.from('payment_methods').select('id,display_name').then(db.unwrap)
    ]);
    if(!panel.isConnected)return;
    const byOrder=new Map(orders.map(order=>[order.id,order]));
    const byMethod=new Map(methods.map(method=>[method.id,method.display_name]));
    panel.innerHTML='<div class="payment-test-heading"><div><h2>Order payments</h2><p>Manual QR transfers · Only verified bank credits count as received.</p></div><span>'+payments.filter(payment=>payment.status==='verification_pending').length+' awaiting review</span></div>'+
      (payments.length?grid(['Order','Customer','Submitted','Required amount','Method','Reference','Status','Action'],payments.map(payment=>{
        const order=byOrder.get(payment.order_id);
        return '<tr><td>#'+e(order?.order_number||'—')+'</td><td>'+e(order?.customer_name||'—')+'</td><td>'+e(phTime(payment.submitted_at||payment.created_at))+'</td><td>'+money(payment.amount)+'</td><td>'+e(byMethod.get(payment.payment_method_id)||'Manual QR')+'</td><td>'+e(payment.transaction_reference||'—')+'</td><td>'+statusIndicator(label[payment.status],tone[payment.status])+'</td><td><button class="button" data-payment="'+e(payment.id)+'">View'+(payment.status==='verification_pending'?' / Review':'')+'</button></td></tr>';
      }).join('')):'<p>No order payments have been started yet.</p>');
    panel.querySelectorAll('[data-payment]').forEach(button=>button.onclick=()=>{
      const payment=payments.find(item=>item.id===button.dataset.payment),order=byOrder.get(payment.order_id);
      const review=payment.status==='verification_pending';
      const dialog=showDetails('Payment for Order #'+e(order?.order_number||'—'),
        '<p><strong>Customer:</strong> '+e(order?.customer_name||'—')+'</p><p><strong>Order total:</strong> '+(order?.total_amount===null?'Pending quote':money(order?.total_amount))+' · <strong>Verified paid:</strong> '+money(order?.amount_paid)+'</p><p><strong>Submitted amount:</strong> '+money(payment.amount)+' · '+e(byMethod.get(payment.payment_method_id)||'Manual QR')+'</p><p><strong>Reference:</strong> '+e(payment.transaction_reference||'Not submitted')+'</p><p><strong>Status:</strong> '+e(label[payment.status])+'</p>'+
        (payment.rejection_reason?'<p><strong>Rejection reason:</strong> '+e(payment.rejection_reason)+'</p>':'')+
        (payment.verification_note?'<p><strong>Bank verification note:</strong> '+e(payment.verification_note)+'</p>':'')+
        (payment.verified_at?'<p><strong>Verified:</strong> '+e(phTime(payment.verified_at))+' · Admin ID '+e(payment.verified_by)+'</p>':'')+
        (payment.proof_storage_path?'<button type="button" class="button" id="open-proof">View private proof</button>':'')+
        (review?'<form id="review-order-payment"><p class="notice">Check the actual incoming credit in MariBank before confirming. A reference or screenshot alone is not proof that LexC received money.</p><label class="form-field">Decision<select name="decision"><option value="paid">Confirm bank credit</option><option value="rejected">Reject proof</option></select></label><label class="form-field">Bank confirmation details or rejection reason<input name="reason" maxlength="1000" required placeholder="Actual bank transaction time / rejection reason"></label><p role="alert"></p><button class="button primary" type="submit">Save review</button></form>':''),button);
      dialog.querySelector('#open-proof')?.addEventListener('click',async event=>{
        const proofButton=event.currentTarget;proofButton.disabled=true;
        const preview=window.open('about:blank','_blank');
        try{const url=await db.privateImage('payment-proofs',payment.proof_storage_path);if(preview)preview.location=url;else location.href=url;}
        catch(error){if(preview)preview.close();dialog.querySelector('[role=alert]')?.replaceChildren(document.createTextNode(error.message));}
        finally{proofButton.disabled=false;}
      });
      const form=dialog.querySelector('#review-order-payment');
      if(form)form.onsubmit=async event=>{
        event.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
        try{
          await db.rpc('review_order_payment',{target_payment:payment.id,decision:form.elements.decision.value,review_reason:form.elements.reason.value.trim()});
          dialog.close();await refreshOrders();
        }catch(error){form.querySelector('[role=alert]').textContent=error.message;submit.disabled=false;}
      };
    });
  }catch(error){if(panel.isConnected)panel.innerHTML='<p role="alert">Unable to load order payments: '+e(error.message)+'</p>';}
}
