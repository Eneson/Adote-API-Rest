
const connection  = require('../database/connection')

var sharp = require('sharp');
var ImageKit = require("imagekit");
const fsPromises = require('fs').promises;


var imagekit = new ImageKit({
  publicKey : "public_8IYkWTIrXKNBNHAc5HEOTMjc/ws=",
  privateKey : "private_KkVCTaVWQ2ZTYiB423cX9H7Gmss=",
  urlEndpoint : "https://ik.imagekit.io/adote/"
});

module.exports = {
  async index(request, response) {    
    const { page = 1, origem, adotado  } = request.query
    let limit = origem === 'web' ? 6 : 10;

    console.log(origem)

    const [count] = await connection('animal').where('adotado', adotado).count()
    
    const animal = await connection('animal')
      .where('adotado', adotado) // Aplica o filtro `adotado` na seleção principal
      .join('user', 'user.id_user', '=', 'animal.id_user')
      .orderBy('id')
      .limit(limit)
      .offset((page - 1) * limit )
      .select([
        'animal.*',
        'user.nome',
        'user.email',
        'user.telefone',
      ])     

    response.header('X-Total-Count', count['count(*)'])    
    return response.json(animal)
    
  },
  
  async myAnimals(request, response){
    const id_user = request.usuario.id_user
    await connection('animal')
    .join('user', 'user.id_user', '=', 'animal.id_user')
    .select([
      'animal.*',
      'user.nome',
      'user.email',
      'user.telefone'
    ])     
    .where('animal.id_user', '=', id_user)
    .then((data) => {
      if(data.length == 0){
        return response.json([])
      }
      return response.json(data)
    }).catch((err) => {
      return response.status(400).send({ error: err })
    })
    
  },

  async create(request, response) {
    const { files } = request; // Alterado para lidar com múltiplos arquivos
    const { Nome, Descricao, DataNasc, Sexo, Tipo, Vacina, id_user, Vermifugado, Castrado } = request.body;
    const Trx_Create_animal = await connection.transaction();

    try {
      const fotoResizes = await Promise.all(
        files.map(async (file) => {
          const FotoName = file.filename;
          const foto_resize = `resize_${FotoName.replace(/[\s()]/g, '_')}`;
          
          // Redimensiona a imagem
          await sharp(`./uploads/${FotoName}`)
            .resize(441, 544)
            .jpeg({ quality: 100 })
            .toFile(`./uploads/${foto_resize}`);

          // Lê o arquivo redimensionado
          const fileBuffer = await fsPromises.readFile(`./uploads/${foto_resize}`);

          // Faz upload para o ImageKit
          await imagekit.upload({
            file: fileBuffer,
            useUniqueFileName: false,
            fileName: foto_resize,
          });

          return foto_resize; // Retorna o nome do arquivo redimensionado
        })
      );

      // Insere os dados no banco com as fotos associadas
        await Trx_Create_animal('animal').insert({
          Nome,
          Descricao,
          DataNasc,
          Sexo,
          FotoName: JSON.stringify(fotoResizes), // Armazena as fotos como um array em JSON
          Tipo,
          Vacina,
          id_user,
          Vermifugado,
          Adotado: 0,
          Castrado,
        });

        await Trx_Create_animal.commit();
        return response.status(200).send('ok');
    } catch (err) {
      console.log(err)
      await Trx_Create_animal.rollback();
      return response.status(500).send({ error: 'Erro inesperado' });
    }
  
  },

  async delete(request, response) {
    const { id } = request.params 
    const Trx_delete_animal = await connection.transaction();

    try {
      await Trx_delete_animal('animal')
        .select('FotoName')
        .first()
        .where('id', '=', id)
        .then(async (data) => {
          const FotoName = JSON.parse(data.FotoName) 
          await Trx_delete_animal('animal')
          .where('id', id)
          .delete()
          .then(async () => {
            await Promise.all(
              FotoName.map(async (imagem) => {
                  try {
                      const result = await imagekit.listFiles({ searchQuery: `name="${imagem}"` });
                      if (result.length > 0) {
                          await imagekit.deleteFile(result[0].fileId);
                          console.log(`Imagem deletada: ${imagem}`);
                      }
                  } catch (err) {
                      console.error(`Erro ao deletar imagem (${imagem}):`, err);
                  }
              })
            );                
          })
        })
      
      Trx_delete_animal.commit()
      return response.status(200).send('ok') 
    } catch (error) {
      Trx_delete_animal.rollback()
      return response.status(500).send({error: 'Erro inesperado'})
    }  
    
  },
  
  async update(request, response) {    
    const { files } = request;
    const { id_user, id, Nome, Descricao, DataNasc, Sexo, Tipo, Vacina, Vermifugado, Castrado } = request.body;
    const Trx_Update_animal = await connection.transaction();
        
    try {
        // Pegando e processando imageUris do req.body
        let imageUris = request.body.imageUris || "";
        let imageArray = imageUris.split(',').filter(uri => uri.trim() !== ""); // Remove strings vazias

        let processedImageArray = imageArray.map(uri => {
            let filename = uri.split('/').pop();
            return filename.startsWith("resize_") ? filename : `resize_${filename}`;
        });

        // Processando e fazendo upload das imagens
        await Promise.all(
            files.map(async (file) => {
                try {
                    const FotoName = file.filename;
                    const foto_resize = `resize_${FotoName.replace(/[\s()]/g, '_')}`;

                    // Redimensiona a imagem
                    await sharp(`./uploads/${FotoName}`)
                        .resize(441, 544)
                        .jpeg({ quality: 100 })
                        .toFile(`./uploads/${foto_resize}`);

                    // Lê o arquivo redimensionado
                    const fileBuffer = await fsPromises.readFile(`./uploads/${foto_resize}`);

                    // Faz upload para o ImageKit
                    await imagekit.upload({
                        file: fileBuffer,
                        useUniqueFileName: false,
                        fileName: foto_resize,
                    });

                } catch (error) {
                    console.error("Erro ao processar imagem:", error);
                    throw new Error("Erro ao redimensionar ou enviar uma das imagens.");
                }
            })
        );

        // Atualiza os dados do animal no banco
        await Trx_Update_animal('animal')
            .update({
                Nome,
                Descricao,
                DataNasc,
                Sexo,
                FotoName: JSON.stringify(processedImageArray),
                Tipo,
                Vacina,
                id_user,
                Vermifugado,
                Adotado: 0,
                Castrado
            })
            .where('id', id);

        // Deletando imagens antigas, se houver
        let imagensParaApagar = request.body.ImagensParaApagar || [];
        if (!Array.isArray(imagensParaApagar)) {
            imagensParaApagar = imagensParaApagar ? [imagensParaApagar] : [];
        }

        await Promise.all(
            imagensParaApagar.map(async (imagem) => {
                try {
                    const result = await imagekit.listFiles({ searchQuery: `name="${imagem}"` });

                    if (result.length > 0) {
                        await imagekit.deleteFile(result[0].fileId);
                        console.log(`Imagem deletada: ${imagem}`);
                    }
                } catch (err) {
                    console.error(`Erro ao deletar imagem (${imagem}):`, err);
                }
            })
        );

        // Commit na transação do banco
        await Trx_Update_animal.commit(); 
        return response.status(200).send({ message: 'Atualização realizada com sucesso!' });

    } catch (error) {
        console.error("Erro geral:", error);
        await Trx_Update_animal.rollback();
        return response.status(500).json({ error: 'Erro inesperado ao atualizar o animal.' });
    }
  },
  async update_Adotado(request,response){    
    const { id } = request.params 
    const { Adotado } = request.body
    await connection('animal').update({
      Adotado: Adotado
    }).where('id', id).then(() => {
      return response.status(200).send('ok') 
    }).catch((err) => {
      return response.status(500).send({error: 'Erro inesperado'})
    })  
      


  },
}
