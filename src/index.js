const express = require('express');
const app = express();
const bodyParser = require('body-parser')
const morgan=require('morgan');
const {mkdirp} = require('mkdirp');
const path = require('path');
const fs = require('fs');
// const fetch = require('node-fetch')

const config = {
    server:{
        url:'https://dummy.restapiexample.com/api/v1'
    }
}
//employees
//employee/1
//create
//update/21
//delete/2

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.static(__dirname + '/public'))

//Configuraciones
app.set('port', process.env.PORT || 3000);
app.set('json spaces', 2)

//Middleware
app.use(morgan('dev'));
app.use(express.urlencoded({extended:false}));
app.use(express.json());

// app.use('/oauth', require('./routes/auth'));
// app.use('/documentos', require('./routes/documentos'));
// app.use('/teclado', require('./routes/teclado'));
// app.use('/generales', require('./routes/generales'));
// app.use('/imagen-login', require('./routes/imagen-login'));


app.all('*', async (req, res)=>{

    //obteniendo los valores del request
    const uri = req.originalUrl;
    const headers = req.headers;
    const method = (req.method || 'GET').toUpperCase();
    const body = req.body || {};

    const url = `${config.server.url}${uri}`;

    const uriParts = uri.split('/').filter(dir => !!dir);
    const uriDirs = uriParts.slice(0,uriParts.length - 1);
    const uriPath = uriParts[uriParts.length - 1];

    const dirBlocks = [...uriDirs];
    uriPath && dirBlocks.push(uriPath);

    const dir = dirBlocks.join('/');

    const pathBlocks = [];

    uriPath && pathBlocks.push(uriPath);
    method &&  pathBlocks.push(method);


    const globalDir = getPath(__dirname+'/mock', dir)
    try {
        await mkdirp(globalDir)
    } catch (err) {
        console.log('No se pudo crear el directorio:'+ globalDir)
        console.log('error:', err)
    }
    const jsonPath = pathBlocks.join('_')+'.json';

    const jsonFullPath = getPath(__dirname +'/mock', dir, jsonPath);
    const existJson = existFile(jsonFullPath);

    if(existJson){
        console.log('existe el archivo :'+jsonPath)
    }else{
        console.log('No existe el archivo:'+jsonPath)
    }

    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
    

    // consulta al servicio final 
    let responseData = {}
    try {

    // fetch(
    //     {
    //         url,
    //         method,
    //         body,
    //         headers,
    //         json:true,
    //         gzip:true,
    //         strictSSL:false
    //     },
    //     (error,response)=>{
    //         console.log('hay error? ====>',error);
    //         const responseAny = error && response? error:response;
    //         responseData = responseAny;
    //     }
    // )

    // delete req.headers.host;
    // delete req.headers.referer;

    const strigBody = JSON.stringify(body);

    console.log('headers:',headers)
    
    const headersClean = {
        ...headers,
        // host:undefined,
        // referer:undefined,
        // 'Content-Type':'application/json'
        // "Content-Type": "application/json",
        // 'content-length': undefined,



    }

    const responseRaw =await fetch(url,
            {
                method,
                body:body,
                headers:headersClean,
                json:true,
                // mode: "cors",
                // cache: "no-cache",
                // credentials: "same-origin",
                // redirect: "follow",
                // referrerPolicy: "no-referrer",
                // gzip:true
            })
            console.log('responseRaw:',responseData);
            responseData = await responseRaw.json()
    } catch (e) {
        console.log('no se pudo hacer el fetch =>', url);
        console.log('error =>', e);
    }

    console.log('escribiendo el archivo...')
    

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
    
    fs.writeFileSync(
        jsonFullPath,
        JSON.stringify(dataToWrite,null,4),
        'utf8'
    )

    res.json({
        uri,
        method,
        headers,
        uriParts,
        uriDirs,
        uriPath,
        dirBlocks,
        dir,
        jsonFullPath
    })
})


//Iniciando el servidor, escuchando...
app.listen(app.get('port'),()=>{
    console.log(`Server listening on port ${app.get('port')}`);
});

function getPath(...dirs){
    return dirs.filter(dir => dir !== '').join(path.sep)
}

function existFile(path){
    try {
        const exists =  fs.statSync(path);
        return !!exists;
    } catch (err) {
        return false;
    }
}