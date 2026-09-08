require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://coffee-bandjen.vercel.app/';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Check if token is set
if (!BOT_TOKEN) {
    console.error('❌ ERROR: BOT_TOKEN not set! Update .env file or environment variables');
    process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Orders storage (in memory - use database for production)
const orders = new Map();

console.log('╔════════════════════════════════════════╗');
console.log('║    🤖 B AND JEN        ║');
console.log('╠════════════════════════════════════════╣');
console.log('║ ✅ Bot Token: Configured              ║');
console.log('║ 📱 Mini App: Connected                ║');
console.log('║ ⏳ Waiting for orders...              ║');
console.log('╚════════════════════════════════════════╝');

// ==================== START COMMAND ====================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Friend';
    
    const welcomeMessage = `
☕ Welcome ${userName}!

Welcome to **B AND JEN** COFFEE!

Click the button below to:
🛒 Browse our coffee menu
📦 Add items to cart
💳 Place your order
📍 Track delivery

Enjoy delicious coffee! ☕
    `;
    
    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '☕ Order Now',
                    web_app: { url: MINI_APP_URL }
                }
            ]]
        }
    });
});

// ==================== RECEIVE ORDERS FROM MINI APP ====================
bot.on('web_app_data', (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'Customer';
    const userId = msg.from.id;
    
    try {
        // Parse order data from mini app
        const orderData = JSON.parse(msg.web_app_data.data);
        
        // Add metadata
        orderData.chatId = chatId;
        orderData.userId = userId;
        orderData.userName = userName;
        orderData.receivedAt = new Date().toISOString();
        orderData.status = 'Pending';
        
        // Store order
        orders.set(orderData.orderId, orderData);
        
        console.log(`✅ Order received: ${orderData.orderId}`);
        
        // ====== SEND CONFIRMATION TO USER ======
        const userConfirmation = `
✅ *ORDER CONFIRMED*

Order ID: \`${orderData.orderId}\`
📅 Time: ${new Date().toLocaleString()}

☕ *Items:*
${orderData.items.map((item, i) => 
    `${i+1}. ${item.name} (${item.size}) x${item.quantity} - $${item.subtotal.toFixed(2)}`
).join('\n')}

💰 *Order Summary:*
Subtotal: $${orderData.subtotal.toFixed(2)}
Delivery: $${orderData.delivery.toFixed(2)}
Tax: $${orderData.tax.toFixed(2)}
*TOTAL: $${orderData.total.toFixed(2)}*

✨ Your order has been received!
⏱️ We'll confirm shortly...
        `;
        
        bot.sendMessage(chatId, userConfirmation, {
            parse_mode: 'Markdown'
        });
        
        // ====== SEND ORDER NOTIFICATION TO ADMIN ======
        if (ADMIN_CHAT_ID) {
            const adminNotification = `
🔔 *NEW ORDER RECEIVED*

Order ID: \`${orderData.orderId}\`
👤 Customer: ${userName} (ID: ${userId})
📞 Chat ID: ${chatId}
🕐 Time: ${new Date().toLocaleString()}

☕ *Items Ordered:*
${orderData.items.map((item, i) => 
    `${i+1}. ${item.name} (${item.size}) x${item.quantity} - $${item.subtotal.toFixed(2)}`
).join('\n')}

💰 *Order Summary:*
Subtotal: $${orderData.subtotal.toFixed(2)}
Delivery: $${orderData.delivery.toFixed(2)}
Tax: $${orderData.tax.toFixed(2)}
*TOTAL: $${orderData.total.toFixed(2)}*

📍 Status: PENDING CONFIRMATION
            `;
            
            bot.sendMessage(ADMIN_CHAT_ID, adminNotification, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✅ Accept Order',
                                callback_data: `accept_${orderData.orderId}`
                            },
                            {
                                text: '❌ Reject Order',
                                callback_data: `reject_${orderData.orderId}`
                            }
                        ]
                    ]
                }
            });
        }
        
    } catch (error) {
        console.error('Error processing order:', error);
        bot.sendMessage(chatId, '❌ Error processing your order. Please try again.');
    }
});

// ==================== ACCEPT/REJECT ORDER CALLBACKS ====================
bot.on('callback_query', (query) => {
    const data = query.data;
    const adminChatId = query.message.chat.id;

    if (String(adminChatId) !== String(ADMIN_CHAT_ID)) {
        bot.answerCallbackQuery(query.id, '❌ You are not authorized.', true);
        return;
    }
    
    if (data.startsWith('accept_')) {
        const orderId = data.replace('accept_', '');
        handleAcceptOrder(orderId, adminChatId, query);
    } else if (data.startsWith('reject_')) {
        const orderId = data.replace('reject_', '');
        handleRejectOrder(orderId, adminChatId, query);
    }
});

// Accept order
function handleAcceptOrder(orderId, adminChatId, query) {
    const order = orders.get(orderId);
    
    if (!order) {
        bot.answerCallbackQuery(query.id, '❌ Order not found', true);
        return;
    }
    
    // Update order status
    order.status = 'Accepted';
    order.acceptedAt = new Date().toISOString();
    
    // Notify admin
    bot.answerCallbackQuery(query.id, '✅ Order Accepted!');
    bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: '✅ Accepted', callback_data: 'noop' }]] },
        { chat_id: adminChatId, message_id: query.message.message_id }
    );
    
    // Notify customer
    const customerMessage = `
✅ *ORDER ACCEPTED*

Order ID: \`${orderId}\`
Status: **ACCEPTED** ✅

Your order is being prepared!
⏱️ Estimated time: 15-20 minutes

We'll notify you when it's ready for delivery.
    `;
    
    bot.sendMessage(order.chatId, customerMessage, { parse_mode: 'Markdown' });
    
    console.log(`✅ Order accepted: ${orderId}`);
}

// Reject order
function handleRejectOrder(orderId, adminChatId, query) {
    const order = orders.get(orderId);
    
    if (!order) {
        bot.answerCallbackQuery(query.id, '❌ Order not found', true);
        return;
    }
    
    // Update order status
    order.status = 'Rejected';
    order.rejectedAt = new Date().toISOString();
    
    // Notify admin
    bot.answerCallbackQuery(query.id, '❌ Order Rejected');
    bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: '❌ Rejected', callback_data: 'noop' }]] },
        { chat_id: adminChatId, message_id: query.message.message_id }
    );
    
    // Notify customer
    const customerMessage = `
❌ *ORDER REJECTED*

Order ID: \`${orderId}\`
Status: **REJECTED** ❌

Unfortunately, we cannot fulfill this order at the moment.

Would you like to:
- 📞 Contact us for more information
- 🔄 Place a new order
    `;
    
    bot.sendMessage(order.chatId, customerMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '☕ Place New Order',
                    web_app: { url: MINI_APP_URL }
                }
            ]]
        }
    });
    
    console.log(`❌ Order rejected: ${orderId}`);
}

// ==================== HELP COMMAND ====================
bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `Your Telegram chat ID is: \`${msg.chat.id}\``, {
        parse_mode: 'Markdown'
    });
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
ℹ️ *B AND JEN - HELP*

*Available Commands:*
/start - Start ordering
/menu - View menu
/orders - Your order history
/help - Show this message

*How to Order:*
1️⃣ Click the Menu Button (☕ Order Now)
2️⃣ Browse our coffee menu
3️⃣ Select size and quantity
4️⃣ Add items to cart
5️⃣ Review and checkout
6️⃣ Order confirmed! ✅

*Order Status:*
📍 PENDING - Waiting for confirmation
✅ ACCEPTED - Being prepared
❌ REJECTED - Cannot be fulfilled

Need help? Contact us! 📞
    `;
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// ==================== MENU COMMAND ====================
bot.onText(/\/menu/, (msg) => {
    const chatId = msg.chat.id;
    
    const menuMessage = `
☕ *BANDJENCAFE MENU*

*CLASSIC COFFEES:*
1️⃣ Espresso - $2.50
2️⃣ Americano - $3.00
3️⃣ Macchiato - $3.75

*MILK-BASED:*
4️⃣ Latte - $3.50
5️⃣ Cappuccino - $4.00
6️⃣ Flat White - $4.25

*SPECIALTY:*
7️⃣ Mocha - $4.50
8️⃣ Iced Coffee - $3.50

*SIZES:*
S - Small (8oz)
M - Medium (12oz)
L - Large (16oz)

_Click the button below to order!_
    `;
    
    bot.sendMessage(chatId, menuMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '🛒 Order Now',
                    web_app: { url: MINI_APP_URL }
                }
            ]]
        }
    });
});

// ==================== ORDERS COMMAND ====================
bot.onText(/\/orders/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Find user's orders
    const userOrders = Array.from(orders.values()).filter(o => o.userId === userId);
    
    if (userOrders.length === 0) {
        bot.sendMessage(chatId, '📋 You have no orders yet. Start ordering now! ☕', {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '☕ Order Now',
                        web_app: { url: MINI_APP_URL }
                    }
                ]]
            }
        });
        return;
    }
    
    let message = `📋 *YOUR ORDER HISTORY*\n\n`;
    userOrders.forEach((order, i) => {
        const date = new Date(order.receivedAt).toLocaleString();
        const statusEmoji = order.status === 'Accepted' ? '✅' : order.status === 'Rejected' ? '❌' : '📍';
        
        message += `*Order #${i + 1}* ${statusEmoji}\n`;
        message += `ID: \`${order.orderId}\`\n`;
        message += `📅 ${date}\n`;
        message += `Items: ${order.items.length}\n`;
        message += `💰 $${order.total.toFixed(2)}\n`;
        message += `Status: ${order.status}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ==================== ADMIN COMMANDS ====================
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    const adminId = parseInt(ADMIN_CHAT_ID);
    
    if (chatId !== adminId) {
        bot.sendMessage(chatId, '❌ You are not authorized to access admin commands.');
        return;
    }
    
    const adminMessage = `
👨‍💼 *ADMIN PANEL*

*Available Commands:*
/stats - View order statistics
/pending - Show pending orders
/clear - Clear all orders

*Dashboard:*
Total Orders: ${orders.size}
Accepted: ${Array.from(orders.values()).filter(o => o.status === 'Accepted').length}
Rejected: ${Array.from(orders.values()).filter(o => o.status === 'Rejected').length}
Pending: ${Array.from(orders.values()).filter(o => o.status === 'Pending').length}
    `;
    
    bot.sendMessage(chatId, adminMessage, { parse_mode: 'Markdown' });
});

// ==================== PENDING ORDERS COMMAND ====================
bot.onText(/\/pending/, (msg) => {
    const chatId = msg.chat.id;

    if (String(chatId) !== String(ADMIN_CHAT_ID)) {
        bot.sendMessage(chatId, '❌ Not authorized.');
        return;
    }

    const pendingOrders = Array.from(orders.values()).filter(order => order.status === 'Pending');

    if (pendingOrders.length === 0) {
        bot.sendMessage(chatId, '✅ There are no pending orders.');
        return;
    }

    pendingOrders.forEach(order => {
        const details = `
🔔 *PENDING ORDER*

Order ID: \`${order.orderId}\`
👤 Customer: ${order.userName}
📞 Chat ID: ${order.chatId}
🕐 Time: ${new Date(order.receivedAt).toLocaleString()}

☕ *Items:*
${order.items.map((item, index) =>
    `${index + 1}. ${item.name} (${item.size}) x${item.quantity} - $${item.subtotal.toFixed(2)}`
).join('\n')}

Subtotal: $${order.subtotal.toFixed(2)}
Delivery: $${order.delivery.toFixed(2)}
Tax: $${order.tax.toFixed(2)}
*TOTAL: $${order.total.toFixed(2)}*
        `;

        bot.sendMessage(chatId, details, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Accept Order', callback_data: `accept_${order.orderId}` },
                    { text: '❌ Reject Order', callback_data: `reject_${order.orderId}` }
                ]]
            }
        });
    });
});

// ==================== STATS COMMAND ====================
bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const adminId = parseInt(ADMIN_CHAT_ID);
    
    if (chatId !== adminId) {
        bot.sendMessage(chatId, '❌ Not authorized.');
        return;
    }
    
    const allOrders = Array.from(orders.values());
    const totalRevenue = allOrders.reduce((sum, o) => sum + o.total, 0);
    
    const stats = `
📊 *ORDER STATISTICS*

Total Orders: ${allOrders.length}
✅ Accepted: ${allOrders.filter(o => o.status === 'Accepted').length}
❌ Rejected: ${allOrders.filter(o => o.status === 'Rejected').length}
📍 Pending: ${allOrders.filter(o => o.status === 'Pending').length}

💰 Total Revenue: $${totalRevenue.toFixed(2)}

📈 Average Order Value: $${allOrders.length > 0 ? (totalRevenue / allOrders.length).toFixed(2) : '0.00'}
    `;
    
    bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
});

// ==================== ERROR HANDLING ====================
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM') {
        console.error('❌ Telegram error:', error.message);
    } else {
        console.error('❌ Polling error:', error);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', () => {
    console.log('\n⏹️  Bot shutting down...');
    bot.stopPolling();
    process.exit(0);
});

console.log('🤖 Bot is listening for messages...');