const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib'); // 新增文字與顏色工具
const fs = require('fs');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

(async () => {
    console.log('========================================');
    console.log('  Canva 簡報自動化 PDF 下載器 (含連結擷取)  ');
    console.log('========================================\n');

    try {
        let targetUrl = await askQuestion('🔗 請貼上 Canva 的公開分享網址 (按 Enter 確認): ');
        targetUrl = targetUrl.split('#')[0];

        if (!targetUrl.includes('canva.com')) {
            console.log('❌ 錯誤：這似乎不是一個有效的 Canva 網址！');
            process.exit(1);
        }

        console.log('\n啟動瀏覽器中...');
        let browser;

        try {
            browser = await chromium.launch({ headless: true, channel: 'chrome' });
        } catch (e1) {
            try {
                browser = await chromium.launch({ headless: true, channel: 'msedge' });
            } catch (e2) {
                try {
                    browser = await chromium.launch({ headless: true });
                } catch (e3) {
                    console.log('⏳ 正在自動為您下載 Chromium...');
                    execSync('npx playwright install chromium', { stdio: 'inherit' });
                    browser = await chromium.launch({ headless: true });
                }
            }
        }

        const page = await browser.newPage({
            viewport: { width: 1920, height: 1080 } 
        });

        console.log('🌐 正在載入 Canva 頁面...');
        await page.goto(targetUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000); 

        // 改用陣列物件來同時儲存「截圖」與「該頁的連結」
        const pagesData = [];
        let currentPage = 1;
        let previousUrl = '';

        console.log('\n📸 開始進行自動翻頁與擷取...');

        while (true) {
            console.log(`正在擷取第 ${currentPage} 頁...`);
            
            // 1. 截圖
            const screenshotBuffer = await page.screenshot({ type: 'png' });
            
            // 2. 掃描當前頁面的所有超連結 (注入 JavaScript 執行)
            const rawLinks = await page.evaluate(`
                Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                 .filter(href => href && href.startsWith('http'))
            `);

            // 3. 過濾掉 Canva 系統自帶的介面連結，並移除重複的網址
            const filteredLinks = [...new Set(rawLinks)].filter(href => !href.includes('canva.com/design/'));

            if (filteredLinks.length > 0) {
                console.log(`   🔗 發現 ${filteredLinks.length} 個外部連結`);
            }

            // 將這頁的資料存起來
            pagesData.push({
                buffer: screenshotBuffer,
                links: filteredLinks
            });

            previousUrl = page.url();
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(2000);

            if (page.url() === previousUrl) {
                console.log('🛑 已到達最後一頁，停止翻頁。');
                break;
            }
            currentPage++;
        }

        await browser.close();
        console.log('\n🛠️ 網頁擷取完畢，開始合成 PDF 檔案...');

        const pdfDoc = await PDFDocument.create();
        // 載入 PDF 內建的英文字體
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // 逐頁處理截圖與連結
        for (let i = 0; i < pagesData.length; i++) {
            const data = pagesData[i];
            
            // --- 繪製簡報截圖頁 ---
            const image = await pdfDoc.embedPng(data.buffer);
            const { width, height } = image.scale(1);
            const imagePage = pdfDoc.addPage([width, height]);
            imagePage.drawImage(image, { x: 0, y: 0, width, height });

            // --- 如果這頁有連結，新增一頁「連結清單」 ---
            if (data.links.length > 0) {
                const linkPage = pdfDoc.addPage([width, height]);
                
                // 設定文字起始的 Y 座標 (從畫面上方往下畫)
                let textY = height - 100;

                // 畫大標題
                linkPage.drawText(`Links from Page ${i + 1}:`, { 
                    x: 100, 
                    y: textY, 
                    size: 36, 
                    font: font, 
                    color: rgb(0, 0, 0) 
                });
                textY -= 60;

                // 逐條畫上網址 (設定為藍色)
                for (const link of data.links) {
                    // 如果網址太多超過頁面底部，避免出錯，這裡做個簡單的保護
                    if (textY < 50) break; 

                    linkPage.drawText(link, { 
                        x: 100, 
                        y: textY, 
                        size: 20, 
                        font: font, 
                        color: rgb(0, 0, 0.8) // 弄成網址常見的深藍色
                    });
                    textY -= 40;
                }
            }
        }

        const timestamp = new Date().getTime();
        const outputPath = `./Canva_Export_WithLinks_${timestamp}.pdf`;
        
        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputPath, pdfBytes);

        console.log(`\n🎉 大功告成！PDF (包含連結清單) 已成功儲存至：${outputPath}\n`);

    } catch (error) {
        console.error('\n❌ 發生未預期的錯誤：', error.message);
    } finally {
        rl.close();
        process.exit(0);
    }
})();