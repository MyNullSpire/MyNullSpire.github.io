export const categories = Object.freeze({
  privacy: 'Privacy',
  endpoint: 'Endpoint',
  backup: 'Backup',
  training: 'Training',
  services: 'Services'
});

export const products = [
  { id:'vaultkey-pro', name:'VaultKey Pro', category:'privacy', price:49, tag:'Password manager', image:'assets/products/vaultkey-pro.png', description:'Encrypted credentials, passkeys and secure sharing for personal or small-team use.', featured:1, meta:['Passkeys','Cloud sync'] },
  { id:'shielddesk', name:'ShieldDesk', category:'endpoint', price:79, tag:'Endpoint defense', image:'assets/products/shielddesk.png', description:'Quiet endpoint protection with device health, policy controls and clear alerts.', featured:2, meta:['12 devices','Realtime'] },
  { id:'restorebox', name:'RestoreBox', category:'backup', price:59, tag:'Encrypted backup', image:'assets/products/restorebox.png', description:'Versioned encrypted backups designed for reliable, low-stress recovery.', featured:3, meta:['Versioned','Encrypted'] },
  { id:'privacynet', name:'PrivateNet', category:'privacy', price:39, tag:'Privacy network', image:'assets/products/privacynet.png', description:'A privacy-focused network layer for safer browsing on untrusted connections.', featured:4, meta:['Multi-device','Privacy-first'] },
  { id:'human-firewall', name:'Human Firewall', category:'training', price:35, tag:'Awareness course', image:'assets/products/human-firewall.png', description:'A practical awareness course covering phishing, accounts, devices and reporting.', featured:5, meta:['Self-paced','Team-ready'] },
  { id:'security-checkup', name:'Security Checkup', category:'services', price:199, tag:'Professional service', image:'assets/products/security-checkup.png', description:'A defensive review with prioritized recommendations and a clear handoff.', featured:6, meta:['1 review','Action plan'] },
  { id:'recovery-session', name:'Recovery Session', category:'services', price:149, tag:'Recovery support', image:'assets/products/recovery-session.png', description:'Guided post-incident recovery for accounts, devices and backup hygiene.', featured:7, meta:['Guided','90 min'] },
  { id:'securemail', name:'SecureMail Kit', category:'privacy', price:29, tag:'Email privacy', image:'assets/products/securemail.png', description:'Practical controls and setup guidance for stronger mailbox security.', featured:8, meta:['Setup kit','Quick start'] },
  { id:'team-guard', name:'Team Guard', category:'endpoint', price:119, tag:'Small-team bundle', image:'assets/products/team-guard.png', description:'Baseline protection for small teams that need a simple security operating layer.', featured:9, meta:['25 users','Policy pack'] },
  { id:'identity-kit', name:'Identity Kit', category:'privacy', price:24, tag:'Account hygiene', image:'assets/products/identity-kit.png', description:'A focused checklist and setup kit for safer logins, recovery and account separation.', featured:10, meta:['Checklist','Fast setup'] },
  { id:'home-shield', name:'Home Shield', category:'endpoint', price:45, tag:'Home defense', image:'assets/products/home-shield.png', description:'Practical device and network hardening guidance for a safer home environment.', featured:11, meta:['Home','Family'] },
  { id:'audit-plus', name:'Audit Plus', category:'services', price:329, tag:'Compliance review', image:'assets/products/audit-plus.png', description:'Documentation-oriented security review for small teams and operational controls.', featured:12, meta:['Evidence pack','Review'] }
];

export const stories = [
  { id:'s1', index:'01', title:'How to spot phishing', time:'3 MIN', image:'assets/stories/01.png', body:'Pause before you click: check the sender, destination, urgency and the account context. A rushed request deserves a second look.' },
  { id:'s2', index:'02', title:'Build a safer password', time:'4 MIN', image:'assets/stories/02.png', body:'Use a password manager, unique credentials and passkeys where available. The goal is fewer reused secrets, not harder-to-remember secrets.' },
  { id:'s3', index:'03', title:'Backups that actually recover', time:'5 MIN', image:'assets/stories/03.png', body:'A backup is only useful when it restores. Keep versions, protect the backup channel and practice a small restore before you need it.' },
  { id:'s4', index:'04', title:'Secure your home Wi-Fi', time:'4 MIN', image:'assets/stories/04.png', body:'Update the router, use a strong unique administrator password, prefer WPA2/WPA3 and keep guest devices separated when practical.' },
  { id:'s5', index:'05', title:'What to do after a breach', time:'5 MIN', image:'assets/stories/05.png', body:'Contain first, then recover. Change compromised credentials, revoke active sessions, verify backups and document what happened.' },
  { id:'s6', index:'06', title:'Security checklist for teams', time:'4 MIN', image:'assets/stories/06.png', body:'Keep a short operating baseline: MFA, least privilege, patching, backup verification, incident contacts and regular awareness practice.' }
];

export const reviews = [
  { quote:'The best part is how quiet the stack feels. We stopped fighting our security tools.', name:'Maya R.', role:'Operations · 18-person team', initials:'MR' },
  { quote:'The recovery session gave us a clear order of operations instead of a wall of alerts.', name:'Daniel K.', role:'Founder · SaaS company', initials:'DK' },
  { quote:'I bought one product and came back for the free stories. The education is genuinely useful.', name:'Leah S.', role:'Independent creator', initials:'LS' },
  { quote:'Everything reads like it was designed by someone who actually has to operate the system.', name:'Arman P.', role:'IT lead · small business', initials:'AP' }
];
