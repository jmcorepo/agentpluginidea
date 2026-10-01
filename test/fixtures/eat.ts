import type { FoodRequest } from '../../src/domain.js';

// Local synthetic UI only; no production data or live selector claim.
export const fixtureFoodRequest: FoodRequest = {
  address: '123 Main Street, Boston, MA 02110', restaurant: 'Example Kitchen',
  restaurantAddress: '50 First Street, Boston, MA 02110', deliverySpeed: 'standard', tipCents: 300,
  items: [{ name: 'Burger', quantity: 2, modifiers: [{ group: 'Cheese', option: 'Cheddar' }], notes: 'No onions' }],
};

export function createEatsFixture(options: { existing?: boolean; wrongBranch?: boolean; wrongQuantity?: boolean; missingContext?: boolean; wrongModifier?: boolean; missingTotal?: boolean; currency?: string; foreignAddress?: boolean; selectorVariant?: boolean } = {}): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <section aria-label="Your cart"><div id="cart">${options.existing ? 'Item: Existing dinner\nQuantity: 1' : 'Your cart is empty'}</div></section>
  <main id="main"><label>Delivery address<input id="address"></label><div id="suggestions"></div><div id="delivery"></div>
  <label>Search restaurants<input id="search" type="search"></label><div id="results"></div></main><div id="modal"></div>
  <script>
  const opts = ${JSON.stringify(options)};
  const state = {address:'',items:[],tip:2,purchases:0,actions:[],speed:'standard'};
  window.fixtureState=state;
  const escape = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const main=document.querySelector('#main'), modal=document.querySelector('#modal');
  function rows(){ return state.items.map(i=>'<li><div>Item: '+escape(i.name)+'</div><div>Quantity: '+(opts.wrongQuantity?1:i.quantity)+'</div><div>Modifiers: Cheese: '+(opts.wrongModifier?'Swiss':escape(i.cheese))+'</div><div>Instructions: '+escape(i.notes||'None')+'</div></li>').join(''); }
  document.querySelector('#address').oninput=e=>{ document.querySelector('#suggestions').innerHTML='<button role="option">'+escape(e.target.value)+'</button>'; document.querySelector('[role=option]').onclick=()=>{state.address=e.target.value;state.actions.push('address');document.querySelector('#suggestions').innerHTML='';}; };
  document.querySelector('#search').oninput=e=>{
    document.querySelector('#results').innerHTML='<button>Example Kitchen</button>';
    document.querySelector('#results button').onclick=()=>{ state.actions.push('restaurant'); main.innerHTML='<h1>Example Kitchen</h1><div>Restaurant address: '+(opts.wrongBranch?'51 Second Street, Boston, MA 02110':'50 First Street, Boston, MA 02110')+'</div><button id="burger">Burger</button><button id="checkout">Checkout</button>';
      document.querySelector('#burger').onclick=()=>{modal.innerHTML='<div role="dialog" aria-label="Burger"><h2>Burger</h2><label>Quantity<input type="number" id="quantity" value="1"></label><fieldset aria-label="Cheese"><legend>Cheese</legend><label><input type="radio" name="cheese" value="Swiss" checked>Swiss</label><label><input type="radio" name="cheese" value="Cheddar">Cheddar</label></fieldset><label>Additional instructions<textarea id="notes"></textarea></label><button id="add">Add to cart</button></div>';
        document.querySelector('#add').onclick=()=>{ state.items.push({name:'Burger',quantity:Number(document.querySelector('#quantity').value),cheese:document.querySelector('[name=cheese]:checked').value,notes:document.querySelector('#notes').value});state.actions.push('add');modal.innerHTML=''; document.querySelector('#cart').innerHTML='<ul aria-label="Cart items">'+rows()+'</ul>'; };
      };
      document.querySelector('#checkout').onclick=checkout;
    };
  };
  function summary(){document.querySelector('#summary').innerHTML='<div>'+escape(opts.currency??'USD')+'</div><div>Subtotal $'+(state.items.reduce((n,i)=>n+i.quantity*10,0)).toFixed(2)+'</div><div>Tax $1.00</div><div>Service fee $2.00</div><div>Delivery fee $3.00</div><div>Discount $0.00</div><div>Tip $'+state.tip.toFixed(2)+'</div>'+(opts.missingTotal?'':'<div>Total $'+(state.items.reduce((n,i)=>n+i.quantity*10,0)+6+state.tip).toFixed(2)+'</div>')+'<div>Delivery in 30–40 minutes</div>';}
  function checkout(){state.actions.push('checkout');main.innerHTML='<h1>Checkout</h1><div>Restaurant: Example Kitchen</div><div>Restaurant address: 50 First Street, Boston, MA 02110</div>'+(opts.missingContext?'':'<div>Delivery address: '+escape(opts.foreignAddress?'123 Main Street, Toronto, ON M5V 1A1':state.address)+'</div>')+'<div>Delivery method: Standard</div><fieldset><label><input type="radio" name="delivery" checked>Standard</label><label><input type="radio" name="delivery">Priority</label></fieldset><ul aria-label="Order items">'+rows()+'</ul><label>Custom tip<input id="tip" value="2.00"></label><div id="summary"></div><button id="purchase">Place order</button>'; document.querySelector('#tip').onchange=e=>{state.tip=Number(e.target.value);state.actions.push('tip');summary();};document.querySelector('#purchase').onclick=()=>state.purchases++;summary();}
  </script></body></html>`;
  // Source-grounded UI selector variants remain synthetic fixtures. Independent
  // summary labels below are strict contract examples, not reported vendor DOM.
  if (!options.selectorVariant) return html;
  return html
    .replace('<section aria-label="Your cart">', '<section>')
    .replace('<div id="cart">', '<div id="cart" data-testid="empty-cart">')
    .replace('<label>Delivery address<input id="address"></label>', '<input id="address" placeholder="Enter delivery address" data-testid="address-input">')
    .replace("'<button>Example Kitchen</button>'", "'<a href=\"/store/example\"><h3>Example Kitchen</h3><span>4.7 • 30 min</span></a>'")
    .replace("document.querySelector('#results button')", "document.querySelector('#results a')")
    .replace("state.actions.push('restaurant'); main.innerHTML", "state.actions.push('restaurant'); event.preventDefault(); main.innerHTML")
    .replace('<button id="burger">Burger</button>', '<button id="burger" data-testid="menu-item"><h3>Burger</h3><span>$10.00</span></button>')
    .replace('<div role="dialog" aria-label="Burger">', '<div role="dialog">')
    .replace('<label>Quantity<input type="number" id="quantity" value="1"></label>', '<span id="quantity" data-testid="item-quantity">1</span><button id="increase" aria-label="Increase quantity">+</button>')
    .replace("document.querySelector('#add').onclick=()=>", "document.querySelector('#increase').onclick=()=>document.querySelector('#quantity').textContent=String(Number(document.querySelector('#quantity').textContent)+1);document.querySelector('#add').onclick=()=>")
    .replace("Number(document.querySelector('#quantity').value)", "Number(document.querySelector('#quantity').textContent)");
}
