require('dotenv').config();
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const { URL } = require('url');

const port = process.env.PORT || 3000; 

  console.log(`Server is running on port ${port}`);

const API_URL = 'https://api.gen-api.ru/api/v1/networks/gpt-4o-mini';
const API_KEY = "sk-s09jseWpl2NFaTyA7pV3RLVZiMOkcZakN2y8By1vAILSqKlS0vXBbu3x96RU";
const REQUEST_URL = 'https://api.gen-api.ru/api/v1/request/get';

// Правила для промта
let rules = {
    "r1": "1. Твоя роль: Инструмент - по созданию HTML страницы с помощью HTML, CSS, JS;",
    "r2": "2. Игнорируй вводные конструкции;",
    "r3": "3. Выдавай ответ только в виде кода;",
    "r4": "4. Раздели код на три части: HTML, CSS и JavaScript. Используй следующие маркеры для обозначения начала и конца каждой части:",
    "r5": "5. HTML: <!-- HTML --> ... <!-- /HTML -->",
    "r6": "6. CSS: /* CSS */ ... /* /CSS */",
    "r7": "7. JavaScript: // JavaScript ... // /JavaScript",
    "r8": "HTML должен содержать структуру страницы. CSS — стили. JS — интерактивность. Ссылки на CSS и JS должны быть следующими:  `<link rel=\"stylesheet\" href=\"/public/generated/style.css\">` и `<script src=\"/public/generated/script.js\"></script>`",
    "r9": "Ответ должен быть только кодом, без лишних пояснений."
};

// Функция для создания промта и вызова API
async function getCodeFromAI(websitePrompt, apiKey, model = "gpt-4o-mini") {
    const prompt = `Rules: \n${rules.r1}\n${rules.r2}\n${rules.r3}\n${rules.r4}\n${rules.r5}\n${rules.r6}\n${rules.r7}\n${rules.r8}\n${rules.r9}\nRequest: ${websitePrompt}`;
    console.log(`Instruction for generating code:\n${prompt}`);
    return await getChatResponse(prompt);
}

// Функция для вызова API 
async function getChatResponse(prompt) {
    try {
        const response = await axios.post(
            API_URL,
            {
                messages: [{ role: "user", content: prompt }],
                max_tokens: 4090, 
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`, 
                    'Content-Type': 'application/json',
                },
            }
        );

        const requestId = response.data.request_id; // Получаем ID запроса

        if (!requestId) {
            console.error("Request ID not found in response:", response.data);
            return "Error: Request ID not found";
        }

        // Опрос API до получения готового ответа
        let finalResponse;
        let attempts = 0; // Счетчик попыток
        const maxAttempts = 60; // Максимальное количество попыток (1 минута при 1 секунде интервала)

        while (attempts < maxAttempts) {
            attempts++;
            const checkResponse = await checkRequestStatus(requestId);
            if (checkResponse && checkResponse.status === 'success') {
                finalResponse = checkResponse;
                break;
            } else if (checkResponse && checkResponse.status === 'processing') {
                console.log(`Request processing... attempt ${attempts}/${maxAttempts}, waiting 1 second`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Ждем 1 секунду
            } else if (checkResponse) {
                console.error("Error checking request status:", checkResponse);
                return "Error checking request status";
            } else {
                console.error("Error checking request status: checkResponse is null");
                return "Error checking request status";
            }
        }

        if (finalResponse && Array.isArray(finalResponse.result) && finalResponse.result.length > 0) {
            return finalResponse.result[0];
        } else {
            console.error("Unexpected final response format:", finalResponse);
            return "Unexpected final response format";
        }

    } catch (error) {
        console.error("Error calling ChatGPT API:", error.response ? error.response.data : error.message);
        return "Error occurred";
    }
}

// Функция для проверки статуса запроса по request_id
async function checkRequestStatus(requestId) {
    try {
        const checkUrl = `${REQUEST_URL}/${requestId}`; // Правильный URL для проверки статуса
        const response = await axios.get(checkUrl, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    } catch (error) {
        console.error("Error checking request status:", error.response ? error.response.data : error.message);
        return null;
    }
}

// Функция для разделения кода на HTML, CSS и JavaScript
function splitCode(code) {
    const htmlRegex = /<!-- HTML -->(.*?)<!-- \/HTML -->/s;
    const cssRegex = /\/\* CSS \*\/([\s\S]*?)\/\* \/CSS \*\//;
    const jsRegex = /\/\/ JavaScript([\s\S]*?)\/\/ \/JavaScript/;

    const htmlMatch = code.match(htmlRegex);
    const cssMatch = code.match(cssRegex);
    const jsMatch = code.match(jsRegex);

    return {
        html: htmlMatch ? htmlMatch[1].trim() : '',
        css: cssMatch ? cssMatch[1].trim() : '',
        js: jsMatch ? jsMatch[1].trim() : ''
    };
}

// Функция для сохранения кода в файлы
async function saveCodeToFiles(code) {
    try {
        const { html, css, js } = splitCode(code);
        const publicDir = path.join(__dirname, 'public', 'generated');

        // Создаем папку 'generated', если она не существует
        await fs.mkdir(publicDir, { recursive: true });

        // Сохраняем HTML
        if (html) {
            await fs.writeFile(path.join(publicDir, 'index.html'), html, 'utf8');
        }

        // Сохраняем CSS
        if (css) {
            await fs.writeFile(path.join(publicDir, 'style.css'), css, 'utf8');
        }

        // Сохраняем JavaScript
        if (js) {
            await fs.writeFile(path.join(publicDir, 'script.js'), js, 'utf8');
        }


        console.log(`Code saved to index.html, style.css, script.js`);

        return { html, css, js, filename: 'index.html' }; // Возвращаем объект с кодом и именем файла
    } catch (error) {
        console.error("Error saving code to files:", error);
        return null;
    }
}

// Функция для обработки HTTP запросов
const server = http.createServer(async (req, res) => {
    const url = req.url;
    const method = req.method;

    if (method === 'POST' && url === '/generate') {
        try {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                const params = new URLSearchParams(body);
                const websitePrompt = params.get('prompt');

                if (!websitePrompt) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end("Error: Please provide a prompt.");
                    return;
                }

                const code = await getCodeFromAI(websitePrompt, API_KEY);
                if (!code) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end("Error generating code.");
                    return;
                }
                const { html, css, js, filename } = await saveCodeToFiles(code); // Получаем объект с кодом и именем файла

                if (!html) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end("Error saving code to files.");
                    return;
                }

                // Отправляем JSON-объект с кодом + имя файла для iframe
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ html, css, js, filename })); // Отправляем JSON-объект

            });
        } catch (error) {
            console.error("Error in /generate:", error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("Internal server error");
        }

    } else if (method === 'POST' && url === '/save-code') { // Обработка сохранения кода
        try {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                const { html, css, js } = JSON.parse(body);

                const publicDir = path.join(__dirname, 'public', 'generated');

                // Сохраняем HTML
                if (html) {
                    await fs.writeFile(path.join(publicDir, 'index.html'), html, 'utf8');
                }

                // Сохраняем CSS
                if (css) {
                    await fs.writeFile(path.join(publicDir, 'style.css'), css, 'utf8');
                }

                // Сохраняем JavaScript
                if (js) {
                    await fs.writeFile(path.join(publicDir, 'script.js'), js, 'utf8');
                }

                console.log('Code saved to files');
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            });
        } catch (error) {
            console.error("Error in /save-code:", error);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("Internal server error");
        }
    } else if (method === 'POST' && url === '/download-code') {
        //  Получаем данные из запроса (html, css, js)
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { html, css, js } = JSON.parse(body);
                const zipFileName = 'code.zip';
                const zipFilePath = path.join(__dirname, 'public', zipFileName);
                const publicGeneratedDir = path.join(__dirname, 'public', 'generated');

                // Создаем директорию, если её нет
                if (!fsSync.existsSync(publicGeneratedDir)) {
                    fsSync.mkdirSync(publicGeneratedDir, { recursive: true });
                }

                const htmlFilePath = path.join(publicGeneratedDir, 'index.html');
                const cssFilePath = path.join(publicGeneratedDir, 'style.css');
                const jsFilePath = path.join(publicGeneratedDir, 'script.js');

                // Изменяем пути в HTML
                let modifiedHtml = html.replace(
                    /<link rel="stylesheet" href="\/public\/generated\/style\.css">/,
                    '<link rel="stylesheet" href="style.css">'
                );
                modifiedHtml = modifiedHtml.replace(
                    /<script src="\/public\/generated\/script\.js"><\/script>/,
                    '<script src="script.js"></script>'
                );

                // Записываем файлы
                await fs.writeFile(htmlFilePath, modifiedHtml);
                await fs.writeFile(cssFilePath, css);
                await fs.writeFile(jsFilePath, js);

                //  Создаем zip архив
                const output = fsSync.createWriteStream(zipFilePath);
                const archive = archiver('zip', {
                    zlib: { level: 9 }
                });

                output.on('close', () => {
                    console.log('Archiver has been finalized and the output file descriptor has closed.');
                    console.log('Total bytes written: ' + archive.pointer());
                });

                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('Archiver warning: ', err);
                    } else {
                        throw err;
                    }
                });

                archive.on('error', (err) => {
                    throw err;
                });

                archive.pipe(output);

                archive.file(htmlFilePath, { name: 'index.html' });
                archive.file(cssFilePath, { name: 'style.css' });
                archive.file(jsFilePath, { name: 'script.js' });

                console.log('Finalizing archive...');
                await archive.finalize();
                console.log('Archive finalized.');

                const fileStream = fsSync.createReadStream(zipFilePath);
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

                fileStream.pipe(res);

                fileStream.on('open', () => {
                    console.log('File stream started.');
                });

                fileStream.on('close', async () => {
                    console.log('File stream closed.');

                    try {
                        await fs.unlink(zipFilePath);
                        console.log(`Deleted ${zipFileName}`);
                    } catch (unlinkErr) {
                        console.error('Error deleting zip file:', unlinkErr);
                    }

                    try {
                        await fs.unlink(htmlFilePath);
                        await fs.unlink(cssFilePath);
                        await fs.unlink(jsFilePath);
                        console.log('Deleted generated files');
                    } catch (deleteErr) {
                        console.error('Error deleting generated files:', deleteErr);
                    }
                });

            } catch (err) {
                console.error('Error creating or sending zip file:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        });
    } else if (url === '/') {  // Обслуживание главной страницы (/)
        try {
            const indexPath = path.join(__dirname, 'public', 'index.html');
            const formHtml = await fs.readFile(indexPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(formHtml);
        } catch (err) {
            console.error('Error serving index.html:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }

    } else if (url.startsWith('/public/') && !url.startsWith('/public/generated/')) {
        const filePath = path.join(__dirname, url);

        try {
            const fileContent = await fs.readFile(filePath);
            const extname = path.extname(filePath);
            let contentType = 'text/html';
            if (extname === '.css') {
                contentType = 'text/css';
            } else if (extname === '.js') {
                contentType = 'text/javascript';
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(fileContent);
        } catch (err) {
            console.error('Error serving static file:', err);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    } else if (url.startsWith('/public/generated/')) {  // Обслуживание статических файлов
        const filePath = path.join(__dirname, url);

        try {
            const fileContent = await fs.readFile(filePath);
            const extname = path.extname(filePath);
            let contentType = 'text/html';
            if (extname === '.css') {
                contentType = 'text/css';
            } else if (extname === '.js') {
                contentType = 'text/javascript';
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(fileContent);
        } catch (err) {
            console.error('Error serving static file:', err);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});