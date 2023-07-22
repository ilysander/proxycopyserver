const express = require('express');
const app = express();
const bodyParser = require('body-parser')
const morgan=require('morgan');
const {mkdirp} = require('mkdirp');
const path = require('path');
const fs = require('fs');

const config = {
    server:{
        url:'https://dummy.restapiexample.com/api/v1',
        validate:[
            {
                name:'/oauth/token',
                params:['client_id']
            }
        ]
    }
}

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
// app.use(express.static(__dirname + '/public'))

//Configuraciones
app.set('port', process.env.PORT || 3000);
app.set('json spaces', 2)

//Middleware
app.use(morgan('dev'));
app.use(express.urlencoded({extended:true}));
app.use(express.json());

//routers, no se deben usar
// app.use('/oauth', require('./routes/auth'));
// app.use('/credito', require('./routes/credito'));
// app.use('/cuentas-integradas', require('./routes/cuentas-integradas'));
// app.use('/documentos', require('./routes/documentos'));
// app.use('/generales', require('./routes/generales'));
// app.use('/imagen-login', require('./routes/imagen-login'));
// app.use('/notificaciones', require('./routes/notificaciones'));
// app.use('/operaciones-frecuentes', require('./routes/operaciones-frecuentes'));
// app.use('/para-ti', require('./routes/para-ti'));
// app.use('/perfil', require('./routes/perfil'));
// app.use('/tarjeta', require('./routes/tarjeta'));
// app.use('/teclado', require('./routes/teclado'));


app.all('*', async (req, res)=>{

    //obteniendo los valores del request
    const uri = req.originalUrl;
    const headers = req.headers;
    const method = (req.method || 'POST').toUpperCase();
    const body = req.body || null;

    const url = `${config.server.url}${uri}`;

    const uriParts = uri.split('/').filter(dir => !!dir);
    const uriDirs = uriParts.slice(0,uriParts.length - 1);
    const uriPath = uriParts[uriParts.length - 1];

    const dirBlocks = [...uriDirs];
    uriPath && dirBlocks.push(uriPath);

    const dir = dirBlocks.join('/');

    const pathBlocks = [];

    // uriPath && pathBlocks.push(uriPath);
    method &&  pathBlocks.push(method);


    const globalDir = getPath(__dirname+'/mock', dir)
    try {
        await mkdirp(globalDir)
    } catch (err) {
        console.log(`[${uri}]`+'No se pudo crear el directorio:'+ globalDir)
        console.log('error:', err)
    }


    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
    
    let codeStatus = '';
    // consulta al servicio final 
    let responseData = {}
    try {

    const strigBody = JSON.stringify(body);

    console.log(`[${uri}]`+"original Header: ", headers)

    
    const headersClean = {
        ...headers,
    }

    delete headersClean["content-length"]
    // delete headersClean["accept-encoding"]
    // delete headersClean["user-agent"]
    // delete headersClean["accept"]
    delete headersClean["host"]
    // delete headersClean["connection"]
    delete headersClean["postman-token"]
    // delete headersClean["connection"]
    // delete headersClean["cache-control"]
    delete headersClean["if-none-match"]

    //if-none-match
    
    console.log(`[${uri}]`+"headersClean: ", headersClean)
    
    const paramsFetch = {
        method,
        headers:headersClean
    }
    if(!!body){
        let formBody = body;
        if(headers['content-type'] === 'application/x-www-form-urlencoded'){
            console.log(`[${uri}] usara URLSearchParams ${JSON.stringify(body)}`)
            formBody = new URLSearchParams(body);
        }
        else{
            console.log(`[${uri}]`+" usara el json.string normal  ")
            formBody = JSON.stringify(body);
            console.log(`[${uri}]  params: `,formBody)
        }
    
        
        if(method === 'POST'){
            console.log(`[${uri}]  sera method POST`)
            paramsFetch.body = formBody;
        }else{
            console.log(`[${uri}]  sera method NO POST osea GET, solo no se le agregara body`)
        }
    }

    const responseRaw =await fetchWithTimeout(url,paramsFetch);
            // {
            //     method,
            //     body:formBody,//:JSON.stringify(body),
            //     headers:headersClean
            //     // mode: "cors",
            //     // cache: "no-cache",
            //     // credentials: "same-origin",
            //     // redirect: "follow",
            //     // referrerPolicy: "no-referrer",
            //     // gzip:true
            // })
            console.log(`[${uri}]`+"responseRaw: %j", responseRaw);
            console.log(`[${uri}]`+"response status: ", responseRaw.status)

            codeStatus = `${responseRaw.status}`
            // if (responseRaw.status == 200) {
                responseData = await responseRaw.json()

                console.log(`[${uri}]`+'sucess => response:',responseData);
            // }
        } catch (e) {
            console.log(`[${uri}]`+'error => error',e);
            console.log(`[${uri}]`+'no se pudo hacer el fetch =>', method, url);
            console.log(`[${uri}]`+'error => response:',responseData);
            if(e.name === 'AbortError'){
                console.log(`[${uri}]`+'error => abortError'); 
            }
    }

    console.log(`[${uri}]`+'escribiendo el archivo...')

    //validate url dentro para reemplazar por el local

    

    // escritura del archivo
    const dataToWrite = {
        uri,
        method,
        req:{
            headers,
            body
        },
        res:{
            statusCode:responseData.statusCode,
            headers:responseData.headers,
            body:responseData,
        }
    }
    

    if(config.server.validate.length>0){

        for (const validador of config.server.validate) {
            const {name,params} =  validador;
            if(uri === name){
                for (const param of params) {
                    const valueParam = body[param]
                    if(!!valueParam){
                        pathBlocks.push(`&${param}=${valueParam}`);
                    }
                }
            }
        }
    }

    !!codeStatus &&  pathBlocks.push(codeStatus);

    const jsonPath = pathBlocks.join('_')+'.json';

    const jsonFullPath = getPath(__dirname +'/mock', dir, jsonPath);
    const existJson = existFile(jsonFullPath);

    if(existJson){
        console.log(`[${uri}]`+'existe el archivo :'+jsonPath)
    }else{
        console.log(`[${uri}]`+'No existe el archivo:'+jsonPath)
    }

    let codeStatusDefault = 200;

    if(!!codeStatus){
        codeStatusDefault = parseInt(codeStatus)
    }
    
    fs.writeFileSync(
        jsonFullPath,
        JSON.stringify(dataToWrite,null,4),
        'utf8'
    )
    res.status(codeStatusDefault).json(responseData);
})


//Iniciando el servidor, escuchando...
app.listen(app.get('port'),()=>{
    console.log(`Server listening on port ${app.get('port')}`);
});

function getPath(...dirs){
    return dirs.filter(dir => dir !== '').join(path.sep)
}

async function fetchWithTimeout(resource, options = {}){
    const {timeout = 8000} = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource,{
        ...options,
        signal:controller.signal
    });
    clearTimeout(id);
    return response;
}

function existFile(path){
    try {
        const exists =  fs.statSync(path);
        return !!exists;
    } catch (err) {
        return false;
    }
}