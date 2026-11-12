const { Bot, Keyboard, InlineKeyboard } = require("grammy");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CARD_DETAILS = process.env.CARD_DETAILS || "اطلاعات کارت هنوز تنظیم نشده است";
const SUPPORT = process.env.SUPPORT_USERNAME || "از طریق مدیر پیگیری کنید";

if (!TOKEN || !ADMIN_ID) {
  throw new Error("لطفاً BOT_TOKEN و ADMIN_ID را در متغیرهای محیطی تنظیم کنید.");
}

const bot = new Bot(TOKEN);
const DATA_FILE = path.join(__dirname, "orders.json");
let orders = {};
try {
  if (fs.existsSync(DATA_FILE)) orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (e) {
  console.error("خواندن orders.json ناموفق بود:", e);
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}
function makeId() {
  return String(Date.now()).slice(-8);
}

const plans = [
  { key: "p30", name: "۳۰ گیگ - یک ماهه", price: "قیمت را با مدیر هماهنگ کنید" },
  { key: "p50", name: "۵۰ گیگ - یک ماهه", price: "قیمت را با مدیر هماهنگ کنید" },
  { key: "p100", name: "۱۰۰ گیگ - یک ماهه", price: "قیمت را با مدیر هماهنگ کنید" }
];
const mainMenu = new Keyboard()
  .text("🛒 خرید VPN").row()
  .text("📋 تعرفه‌ها").text("📞 پشتیبانی")
  .resized();

bot.command("start", async (ctx) => {
  await ctx.reply(
    "به فروشگاه WIN VPN خوش آمدید. برای سفارش، «خرید VPN» را انتخاب کنید.",
    { reply_markup: mainMenu }
  );
});

bot.hears("📋 تعرفه‌ها", async (ctx) => {
  const list = plans.map(p => `• ${p.name} — ${p.price}`).join("\n");
  await ctx.reply("📋 تعرفه‌های فعلی:\n" + list + "\n\nقیمت نهایی را پیش از پرداخت از مدیر بپرسید.");
});

bot.hears("📞 پشتیبانی", async (ctx) => {
  await ctx.reply("پشتیبانی: " + SUPPORT);
});

bot.hears("🛒 خرید VPN", async (ctx) => {
  const kb = new InlineKeyboard();
  for (const p of plans) kb.text(p.name, `plan:${p.key}`).row();
  await ctx.reply("یکی از بسته‌ها را انتخاب کنید:", { reply_markup: kb });
});

bot.callbackQuery(/^plan:(.+)$/, async (ctx) => {
  const plan = plans.find(p => p.key === ctx.match[1]);
  if (!plan) return ctx.answerCallbackQuery({ text: "این بسته پیدا نشد." });
  const id = makeId();
  orders[id] = {
    id, userId: ctx.from.id, chatId: ctx.chat.id,
    username: ctx.from.username || "",
    firstName: ctx.from.first_name || "",
    plan: plan.name, price: plan.price,
    status: "awaiting_receipt", createdAt: new Date().toISOString()
  };
  save();
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `بسته انتخابی: ${plan.name}\nمبلغ: ${plan.price}\n\n` +
    `واریز کارت‌به‌کارت:\n${CARD_DETAILS}\n\n` +
    `پس از پرداخت، عکس رسید را همین‌جا ارسال کنید.\nشماره سفارش شما: ${id}`
  );
});

bot.on("message:photo", async (ctx) => {
  const order = Object.values(orders).find(o =>
    o.userId === ctx.from.id && o.status === "awaiting_receipt"
  );
  if (!order) return ctx.reply("ابتدا از منوی خرید، یک بسته انتخاب کنید.");
  order.status = "receipt_sent";
  order.receiptFileId = ctx.message.photo.at(-1).file_id;
  save();

  const who = order.username ? `@${order.username}` : order.firstName;
  const kb = new InlineKeyboard()
    .text("✅ تأیید پرداخت", `approve:${order.id}`)
    .text("❌ رد پرداخت", `reject:${order.id}`);
  await bot.api.sendPhoto(ADMIN_ID, order.receiptFileId, {
    caption: `سفارش جدید ${order.id}\nمشتری: ${who}\nشناسه کاربر: ${order.userId}\nبسته: ${order.plan}\nمبلغ: ${order.price}`,
    reply_markup: kb
  });
  await ctx.reply("رسیدت برای مدیر ارسال شد. بعد از بررسی، نتیجه از همین ربات به تو اعلام می‌شود.");
});

bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery({ text: "دسترسی ندارید." });
  const order = orders[ctx.match[1]];
  if (!order || order.status !== "receipt_sent") {
    return ctx.answerCallbackQuery({ text: "این سفارش در وضعیت قابل تأیید نیست." });
  }
  order.status = "awaiting_config";
  save();
  await ctx.answerCallbackQuery({ text: "پرداخت تأیید شد." });
  await ctx.reply(`پرداخت سفارش ${order.id} تأیید شد.\nحالا کانفیگ یا لینک اختصاصی این مشتری را در همین چت به‌صورت یک پیام متنی بفرست تا برای مشتری ارسال شود.`);
  await bot.api.sendMessage(order.chatId, "پرداختت تأیید شد ✅\nدر حال آماده‌سازی سرویس تو هستیم.");
});

bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery({ text: "دسترسی ندارید." });
  const order = orders[ctx.match[1]];
  if (!order || order.status !== "receipt_sent") {
    return ctx.answerCallbackQuery({ text: "این سفارش در وضعیت قابل رد نیست." });
  }
  order.status = "rejected";
  save();
  await ctx.answerCallbackQuery({ text: "سفارش رد شد." });
  await bot.api.sendMessage(order.chatId, `رسید سفارش ${order.id} تأیید نشد. لطفاً با پشتیبانی تماس بگیر.`);
});

bot.on("message:text", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID || ctx.message.text.startsWith("/")) return;
  const order = Object.values(orders).find(o => o.status === "awaiting_config");
  if (!order) return;
  order.status = "delivered";
  order.deliveredAt = new Date().toISOString();
  save();
  await bot.api.sendMessage(order.chatId, `🎉 سرویس WIN VPN آماده است:\n\n${ctx.message.text}`);
  await ctx.reply(`کانفیگ سفارش ${order.id} برای مشتری ارسال شد ✅`);
});

bot.command("orders", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const pending = Object.values(orders).filter(o => !["delivered", "rejected"].includes(o.status));
  if (!pending.length) return ctx.reply("سفارش بازی وجود ندارد.");
  await ctx.reply(pending.map(o => `${o.id} | ${o.plan} | ${o.status}`).join("\n"));
});

bot.catch(err => console.error("خطای ربات:", err));
bot.start();
console.log("WIN VPN bot is running.");
