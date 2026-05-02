const fs = require('fs');
let content = fs.readFileSync('C:/Users/MY PC/OneDrive/Imagens/New folder/secuee/dcf/home.js', 'utf8');

const securityFuncs = `
    // SECURITY: Validate transaction BEFORE deduction
    async function validateBalanceDeduction(action, amount, details) {
        try {
            const { data: wallet, error } = await supabaseClient
                .from('wallets')
                .select('balance')
                .eq('user_id', userId)
                .single();
            
            if (error || !wallet) {
                console.error('Wallet not found:', error);
                return { valid: false, serverBalance: 0, message: 'Carteira nao encontrada' };
            }
            
            const serverBalance = parseFloat(wallet.balance) || 0;
            
            if ((action === 'withdrawal' || action === 'investment') && amount > serverBalance) {
                return { valid: false, serverBalance, message: 'Saldo insuficiente' };
            }
            
            return { valid: true, serverBalance, message: 'OK' };
        } catch (e) {
            console.error('Validation error:', e);
            return { valid: false, serverBalance: userBalance, message: 'Erro de validacao' };
        }
    }`;

// Insert after syncWalletToDB closing brace
const target = `        }
    }

    async function loadUserData() {
        try {
            // Fetch wallet`;
const insert = `        }
    }${securityFuncs}

    async function loadUserData() {
        try {
            // Fetch wallet`;

content = content.replace(target, insert);
fs.writeFileSync('C:/Users/MY PC/OneDrive/Imagens/New folder/secuee/dcf/home.js', content);
console.log('Done');