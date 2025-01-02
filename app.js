const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot');
require("dotenv").config();
const axios = require('axios');
const https = require('https');

const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MongoAdapter = require('@bot-whatsapp/database/mongo');
const path = require("path");
const fs = require("fs");
const chat = require("./chatGPT");
const { handlerAI } = require("./whisper");

const menuPath = path.join(__dirname, "mensajes", "menu.txt");
const menu = fs.readFileSync(menuPath, "utf8");

const pathConsultas = path.join(__dirname, "mensajes", "promptConsultas.txt");
const promptConsultas = fs.readFileSync(pathConsultas, "utf8");

const cursoPath = path.join(__dirname, "mensajes", "curso.txt");
const cursoInfo = fs.readFileSync(cursoPath, "utf8");

const flowVoice = addKeyword(EVENTS.VOICE_NOTE).addAnswer("Esta es una nota de voz", null, async (ctx, ctxFn) => {
    const text = await handlerAI(ctx);
    const prompt = promptConsultas;
    const consulta = text;
    const answer = await chat(prompt, consulta);
    await ctxFn.flowDynamic(answer.content);
});

const flowVERAZ = addKeyword(['veraz'])
    .addAnswer(
        'Dígame su CUIL así verificamos.', 
        { capture: true },  // Para capturar la respuesta del usuario
        async (ctx, { fallBack, flowDynamic }) => {
            const cuil = ctx.body;

            // Validamos que el CUIL solo contenga números, sin espacios ni caracteres especiales
            const cuilValido = /^\d+$/.test(cuil); 

            if (!cuilValido) {
                // Si no es válido, envía un mensaje de error y repite la solicitud
                return fallBack(
                    '❌ *CUIL no válido*. Por favor, ingrese solo números, sin guiones ni espacios.'
                );
            }

            const url = `https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/${cuil}`;
            console.log("URL de la API:", url); // Log para verificar la URL

            // Llamada a la API para verificar la situación crediticia
            try {
                const response = await axios.get(url, {
                    httpsAgent: new https.Agent({ rejectUnauthorized: false })
                });

                console.log("Respuesta de la API:", response.data); // Log para verificar la respuesta de la API

                // Verifica si la respuesta contiene la propiedad "results"
                if (!response.data || !response.data.results) {
                    console.error("La respuesta de la API no contiene la propiedad 'results'");
                    return fallBack("No se pudo determinar su situación crediticia. Por favor, intente nuevamente más tarde.");
                }

                const { results } = response.data;
                const periodos = results.periodos || [];
                let respuestas = [];

                // Recorre los periodos y entidades para encontrar la situación
                for (const periodo of periodos) {
                    for (const entidad of periodo.entidades) {
                        if (entidad.situacion) {
                            let respuesta;
                            switch (entidad.situacion) {
                                case 1:
                                    respuesta = `Usted está en buena situación crediticia con ${entidad.entidad}.`;
                                    break;
                                case 2:
                                case 3:
                                case 4:
                                    respuesta = `Su situación crediticia presenta problemas recientes con ${entidad.entidad}. ¿Las abonó?`;
                                    break;
                                case 5:
                                    respuesta = `Usted se encuentra en situación de mora con ${entidad.entidad}. ¿De cuándo es la deuda?`;
                                    break;
                                default:
                                    respuesta = `No se pudo determinar su situación crediticia con ${entidad.entidad}. Por favor, intente nuevamente más tarde.`;
                            }
                            respuestas.push(respuesta);
                        }
                    }
                }

                // Si no se encontró ninguna situación, envía un mensaje de error
                if (respuestas.length === 0) {
                    console.error("No se encontró ninguna situación en la respuesta de la API");
                    return fallBack("No se pudo determinar su situación crediticia. Por favor, intente nuevamente más tarde.");
                }

                // Envía todas las respuestas concatenadas
                return await flowDynamic(respuestas.join('\n'));
            } catch (error) {
                console.error("Error al llamar a la API:", error);
                return fallBack("Hubo un error al verificar su situación crediticia. Por favor, intente nuevamente más tarde.");
            }
        }
    );

const flowCurso = addKeyword(['curso', 'informacion curso'])
    .addAnswer(
        cursoInfo,  // Envía el contenido del archivo curso.txt
        { delay: 2000 }  // Agrega un pequeño retraso para naturalidad
    )
    .addAnswer(
        'Aquí tienes más información sobre el curso:',
        {
            media: "https://gsgdev.tiendup.com/curso/chat-gpt-para-abogados-as-y-estudiantes-de-derecho"
        }
    )
    .addAnswer( // Captura cualquier otro mensaje que envíe el usuario
        null,  // No enviamos ningún mensaje adicional aquí
        { capture: true },  // Capturamos el siguiente mensaje del usuario
        async (ctx, { flowDynamic }) => {
            // Respondemos con un mensaje predefinido
            await flowDynamic(
                "La Dra. le responderá a la brevedad"
            );
        }
    );

const flowWelcome = addKeyword(['veraz','quiero recibir informacion', 'cursos', 'menu', 'información','informacion','nosis', '¡Hola! Podrías darme más información de']) // Palabras clave que activarán este flujo
    .addAnswer(
        "👋 ¡Bienvenido/a! 🙌\n\nSoy un 🤖 que ayuda a la doctora San German. Por favor, elige alguna de las siguientes opciones:",
        { delay: 5000 }  // Retraso para que el bot se vea más natural
    )
    .addAnswer(
        menu,  // Envía el contenido del archivo menu.txt
        { capture: true },
        async (ctx, { gotoFlow, flowDynamic }) => {
            // Si el mensaje no es ninguna de las opciones válidas (1, 2, 3, 0), no hacer nada
            if (!["1", "2", "3", "0"].includes(ctx.body)) {
                return;  // Esto hará que no responda nada
            }

            // Si elige una opción válida, entonces ejecutamos la lógica correspondiente
            switch (ctx.body) {
                case "1":
                    return gotoFlow(flowCurso);
                case "2":
                    return gotoFlow(flowVERAZ);
                case "3":
                    return gotoFlow(flowConsultas);
                case "0":
                    return await flowDynamic(
                        "👋 *Saliendo...* Puedes volver a acceder a este menú escribiendo '*Menu*'."
                    );
            }
        }
    );

const flowConsultas = addKeyword(EVENTS.ACTION)
    .addAnswer('Si tenes dudas sobre alguno de los servicios escribime!');

const main = async () => {
    const adapterDB = new MongoAdapter({
        dbUri: process.env.MONGO_DB_URI,
        dbName: "YoutubeTest"
    });

    const adapterFlow = createFlow([flowWelcome, flowCurso, flowVERAZ, flowConsultas]);
    const adapterProvider = createProvider(BaileysProvider);

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    QRPortalWeb();
};

main();