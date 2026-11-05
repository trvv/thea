import assert from 'node:assert/strict';

// DOM/Popover double: tests menu ownership and interactions without a browser.
class Node {
 constructor(tag='CONTEXT-MENU') { this.tagName=tag;this.style={};this.children=[];this.events=new Map();this.attributes=new Map();this.isConnected=false;this.opened=false; }
 attachShadow(){return this.shadowRoot={innerHTML:''};}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){return this.attributes.get(key)??null;}
 removeAttribute(key){this.attributes.delete(key);}
 addEventListener(type,handler){const handlers=this.events.get(type)||[];handlers.push(handler);this.events.set(type,handlers);}
 emit(type,extra={}){const event={target:this,...extra};for(const handler of this.events.get(type)||[])handler(event);}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);if(this.isConnected){node.isConnected=true;node.connectedCallback?.();}}}
 replaceChildren(...nodes){for(const child of [...this.children])child.remove();this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;this.isConnected=false;this.disconnectedCallback?.();}
 getRootNode(){return document;}
 closest(tag){let node=this;while(node){if(node.tagName.toLowerCase()===tag)return node;node=node.parent;}return null;}
 querySelectorAll(selector){const tags=selector.split(',').map(part=>part.trim().split(':')[0].toUpperCase());const result=[];const visit=node=>{for(const child of node.children){if(tags.includes(child.tagName)&&!child.disabled)result.push(child);visit(child);}};visit(this);return result;}
 focus(){const previous=document.activeElement;document.activeElement=this;previous?.emit('blur');this.emit('focus');}
 showPopover(){assert.equal(this.getAttribute('popover'),'auto');this.opened=true;this.emit('toggle',{newState:'open'});}
 hidePopover(){if(this.opened){this.opened=false;this.emit('toggle',{newState:'closed'});}}
 matches(selector){return selector===':popover-open'&&this.opened;}
 getBoundingClientRect(){const left=this.rect?.left??parseFloat(this.style.left)??0,top=this.rect?.top??parseFloat(this.style.top)??0;const width=this.rect?.width??200,height=this.rect?.height??120;return{left:Number.isFinite(left)?left:0,top:Number.isFinite(top)?top:0,right:(Number.isFinite(left)?left:0)+width,bottom:(Number.isFinite(top)?top:0)+height,width,height};}
 checkValidity(){return Number.isInteger(Number(this.value))&&Number(this.value)>=Number(this.min);}
}
globalThis.HTMLElement=Node;
globalThis.document={createElement:tag=>new Node(tag.toUpperCase()),addEventListener(){},activeElement:null};
globalThis.customElements={define(){}};
globalThis.innerWidth=800;globalThis.innerHeight=600;
const {ContextMenu}=await import('../main.js');
const root=new ContextMenu();root.isConnected=true;root.connectedCallback();
const invoker=new Node('BUTTON');invoker.focus();
let representation='linear',axis=0,bars=1;
root.items=[
 {label:'Bars',input:'number',min:0,value:1,action:value=>{bars=value;}},
 {label:'View',items:[
  {label:'Linear',checked:true,action:()=>{representation='linear';}},
  {label:'Trigraph',checked:false,action:()=>{representation='trigraph';}}
 ]},
 {label:'Coordinates',items:[
  {label:'System',value:'cartesian',options:[{label:'Cartesian',value:'cartesian'},{label:'Radial',value:'radial'}],action(){}},
  {label:'X',value:0,options:[{label:'Column',value:0},{label:'Row',value:1}],action:value=>{axis=value;}}
 ]},
 {label:'Disabled',disabled:true,action:()=>{throw Error('Disabled command ran');}}
];
assert.equal(root.querySelectorAll('select').length,0,'Dropdowns remain');
assert.deepEqual(root.children.map(node=>node.tagName),['LABEL','BUTTON','BUTTON','BUTTON']);
root.open(20,20);
const representationButton=root.children[1],coordinateButton=root.children[2];
assert.equal(document.activeElement,representationButton,'Opening focused the numeric editor instead of a menu item');
assert.equal(representationButton.getAttribute('aria-haspopup'),'menu');
assert.equal(representationButton.children.at(-2).textContent,'Linear');
function key(menu,target,key){let prevented=false,stopped=false;menu.navigate({target,key,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});return{prevented,stopped};}
assert(key(root,representationButton,'ArrowRight').prevented);
let child=root.childMenu;
assert(child.matches(':popover-open')&&root.matches(':popover-open'));
assert.equal(representationButton.getAttribute('aria-expanded'),'true');
assert.equal(document.activeElement,child.children[0]);
assert.equal(root.controls().length,3,'Child controls polluted parent navigation');
key(child,child.children[0],'ArrowDown');assert.equal(document.activeElement,child.children[1]);
child.children[1].emit('click');
assert.equal(representation,'trigraph');assert.equal(root.opened,false);assert.equal(root.childMenu,null);
assert.equal(document.activeElement,invoker);

root.open(20,20);coordinateButton.emit('click');
child=root.childMenu;
const axisButton=child.children[1];axisButton.emit('click');
const grandchild=child.childMenu;
assert(grandchild.opened&&child.opened&&root.opened);
assert.equal(grandchild.children[0].getAttribute('aria-checked'),'true','Numeric zero was not selected');
key(grandchild,grandchild.children[0],'ArrowLeft');
assert.equal(child.childMenu,null);assert.equal(document.activeElement,axisButton);
axisButton.emit('click');child.childMenu.children[1].emit('click');
assert.equal(axis,1);assert.equal(root.opened,false);

root.open(20,20);representationButton.emit('click');
child=root.childMenu;
key(child,child.children[0],'Escape');
assert(root.opened&&!child.opened);assert.equal(document.activeElement,representationButton);
key(root,representationButton,'Escape');assert(!root.opened);assert.equal(document.activeElement,invoker);
root.open(20,20);root.children[3].emit('click');assert(root.opened,'Disabled item closed the menu');
const field=root.children[0].children[0];
assert.equal(key(root,field,'ArrowDown').prevented,false,'Numeric input lost native keyboard behavior');
field.value=0;field.emit('change');assert.equal(bars,0);assert(root.opened);
field.value=-1;field.emit('change');assert.equal(bars,0);

// Menus flip left rather than being clamped over their parent at the screen edge.
representationButton.rect={left:680,top:560,width:110,height:28};
representationButton.emit('click');child=root.childMenu;
assert(parseFloat(child.style.left)<680);assert(parseFloat(child.style.top)+child.getBoundingClientRect().height<=600);
child.hidePopover();assert.equal(root.childMenu,null);assert.equal(representationButton.getAttribute('aria-expanded'),'false');
representationButton.emit('click');assert(root.childMenu.opened,'Dismissed submenu could not reopen');

const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
const timers=new Map();let serial=0;
globalThis.setTimeout=callback=>{timers.set(++serial,callback);return serial;};
globalThis.clearTimeout=id=>timers.delete(id);
try{
 coordinateButton.emit('pointerenter');assert(timers.size===1);
 const [id,callback]=timers.entries().next().value;timers.delete(id);callback();
 assert.equal(root.childButton,coordinateButton);
 root.close();assert.equal(timers.size,0);assert.equal(root.childMenu,null);
 root.open(20,20);representationButton.emit('pointerenter');assert.equal(timers.size,1);
 representationButton.emit('pointerleave');assert.equal(timers.size,0);
}finally{globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;root.close();}
console.log('Context-menu checks pass: popover submenus, no selects, current choices, nested keyboard navigation, close/focus behavior, hover, numeric input, viewport flipping, dismissal/reopening, cleanup.');
