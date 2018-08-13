'use strict';
const mongoose = require('mongoose');
const _ = require('lodash');
const Bang = require('bang');
const to = require('await-to');
mongoose.Promise = global.Promise;

/*
* La idea de esto es generar una interface estandar para consultas
*/
// TODO: Verificar algunas validaciones en funciones de interfaz
// TODO: Agregar valor default a modelos con fn
// TODO: Agregar sólo guardar propiedades de esquema
// Todo: se puede hacer dinamico el id falsamente asi como esta el _id -> id
// TODO: if (spec === 'between') {
//       query[k] = { $gte: cond[0], $lte: cond[1] };
      // } else if (spec === 'like') {
      //   query[k] = { $regex: new RegExp(cond, options) };
      // } else if (spec === 'nlike') {
      //   query[k] = { $not: new RegExp(cond, options) };
      // } else if (spec === 'neq') {
      //   query[k] = { $ne: cond };
      // } else if (spec === 'regexp') {
      //   if (cond.global)
      //     console.warn('MongoDB regex syntax does not respect the `g` flag');
      //   query[k] = { $regex: cond };

const internals = {};

internals.createConnection = function(datasource) {
  return mongoose.createConnection(datasource.url || internals.generateMongoDBURL(datasource));
}

internals.generateMongoDBURL = function(options) {
  options.hostname = (options.hostname || options.host || '127.0.0.1');
  options.port = (options.port || 27017);
  options.database = (options.database || options.db || 'test');
  var username = options.username || options.user;
  if (username && options.password) {
    return 'mongodb://' + username + ':' + options.password + '@' + options.hostname + ':' + options.port + '/' + options.database;
  } else {
    return 'mongodb://' + options.hostname + ':' + options.port + '/' + options.database;
  }
}

function createConnection(datasource) {
  return internals.createConnection(datasource);
}

class MongodbModel {
  constructor(schemaStandar, connection) {
    console.log('schemaStandar.name:', schemaStandar.name);
    const modelSchema = this.generateModelSchema(schemaStandar.properties);
    this.model = connection.model(schemaStandar.name, modelSchema, schemaStandar.name);
    this.relations = schemaStandar.relations || {};
  }

  generateModelSchema(schema) {
    const mongooseSchema = {};
    let propertyType;
    let propertyRequired;

    for (let property in schema) {
      switch(schema[property].type.toLowerCase()) {
        case 'string':
          propertyType = String;
          break;
        case 'number':
          propertyType = Number;
          break;
        case 'date':
          propertyType = Date;
          break;
        case 'boolean':
          propertyType = Boolean;
          break;
        case 'array':
          propertyType = Array;
          break;
        case 'object':
          propertyType = Object;
          break;
        case 'objectid':
          propertyType = mongoose.Schema.Types.ObjectId;
          break;

        default:
          console.log('Not supported property type');
          return;
      }

      propertyRequired = schema[property].required ? true : false;

      mongooseSchema[property] = {
        type: propertyType,
        required: propertyRequired
      };
      if (schema[property].default !== undefined) {
        mongooseSchema[property].default = schema[property].default;
      }
    }

    const modelSchema = new mongoose.Schema(mongooseSchema, { versionKey: false });

    return modelSchema;
  }

  renameProperties(sourceObj, replaceList, destObj) {
    destObj = destObj || {};

    Object.keys(sourceObj).forEach((key) => {

      if (sourceObj[key] instanceof Array) {

        if (replaceList[key]) {
          var newName = replaceList[key];
          destObj[newName] = [];
          this.renameProperties(sourceObj[key], replaceList, destObj[newName]);
        } else if (!replaceList[key]) {
          destObj[key] = [];
          this.renameProperties(sourceObj[key], replaceList, destObj[key]);
        }

      } else if (typeof sourceObj[key] === 'object') {
        if (replaceList[key]) {
          var newName = replaceList[key];
          destObj[newName] = {};
          this.renameProperties(sourceObj[key], replaceList, destObj[newName]);
        } else if (!replaceList[key]) {
          destObj[key] = {};
          this.renameProperties(sourceObj[key], replaceList, destObj[key]);
        }

      } else {
        if (replaceList[key]) {
          var newName = replaceList[key];
          destObj[newName] = sourceObj[key];
        } else if (!replaceList[key]) {
          destObj[key] = sourceObj[key];
        }
      }

    });

    return destObj;
  }

  transformFilter(filter) {
    const replaceList = {
      id: '_id', // for mongodb
      and: '$and',
      or: '$or',
      gt: '$gt',
      gt: '$gt',
      lt: '$lt',
      lte: '$lte',
      inq: '$in',
      nin: '$nin',
      neq: '$ne',
      regexp: '$regex',
      regexOpt: '$options'
    };
    return this.renameProperties(filter, replaceList)
  }

  buildQuery(type, filter, where, id) {
    if (filter) filter = this.transformFilter(filter || {});
    if (where) where = this.transformFilter(where || {});

    let findQuery = this.model;

    switch (type) {
      case('count'):
        findQuery = findQuery.count(where);
        break;
      case('find'):
        findQuery = findQuery.find(filter ? filter.where : undefined);
        break;
      case('findOne'):
        findQuery = findQuery.findOne(filter ? filter.where : undefined);
        break;
      case('findById'):
        findQuery = findQuery.findById(id);
        break;
      default:
        console.log('Not supported query type');
        return;
    }

    if (['find','findOne', 'findById'].indexOf(type) !== -1
        && filter) {
      if (filter.order && filter.order.field && filter.order.criteria) {
        const order = {}
        order[filter.order.field] = filter.order.criteria;
        findQuery = findQuery.sort(order);
      }
      if (filter.skip) findQuery = findQuery.skip(filter.skip);
      if (filter.limit) findQuery = findQuery.limit(filter.limit);
      if (filter.fields) findQuery = findQuery.select(filter.fields);
    }

    return findQuery;
  }

  changeResponseObject(responseTrans) {
    for (let property in responseTrans) {
      if (responseTrans[property] instanceof mongoose.Types.ObjectId) {
        responseTrans[property] = responseTrans[property].toString();
        if (property === '_id') {
          responseTrans.id = responseTrans._id;
          delete responseTrans._id;
        }
      }
    }
    return responseTrans;
  }

  transformResponse(response) {
    if (response instanceof Array) {
      response.map(res => this.changeResponseObject(res));
    }
    else if (typeof response === 'object') {
      response = this.changeResponseObject(response);
    }

    return response;
  }

  async includeHasMany(sources, relation, relationName, relationFilter) {
    for (let i = 0; i < sources.length; i++) {
      let filter = {};
      if (relationFilter) {
        if (relationFilter.where) {
          relationFilter.where[relation.foreignKey] = { inq: [ sources[i].id ] };
        }
        else {
          relationFilter.where = { [relation.foreignKey]: { inq: [ sources[i].id ] } };
        }
        filter = relationFilter;
      }
      else {
        filter = { where: { [relation.foreignKey]: { inq: [ sources[i].id ] } } };
      }

      const { data: relatedModels, err } = await to(this.models[relation.model].find(filter));
      if (err) throw Bang.wrap(err);

      sources[i][relationName] = relatedModels;
    };

    return sources;
  }

  async includeBelongsTo(sources, relation, relationName, relationFilter) {
    const sourceIds = sources.map(source => {
      return source[relation.foreignKey];
    });

    let filter = {};
    if (relationFilter) {
      if (relationFilter.where) {
        relationFilter.where.id = { inq: sourceIds };
      }
      else {
        relationFilter.where = { id: { inq: sourceIds } };
      }
      filter = relationFilter;
    }
    else {
      filter = { where: { id: { inq: sourceIds } } };
    }

    const { data: relatedModels, err } = await to(this.models[relation.model].find(filter));
    if (err) throw Bang.wrap(err);

    sources.forEach((source, index) => {
      let relatedModelIndex = _.findIndex(relatedModels, { id: source[relation.foreignKey] });
      if (relatedModelIndex !== -1) {
        sources[index][relationName] = relatedModels[relatedModelIndex];
      }
    });

    return sources;
  }

  async includeByType(results, include) {
    let relationName, relationFilter;

    if (typeof include === 'object') {
      relationName = include.relation;
      relationFilter = include.scope || {};
    }
    else {
      relationName = include;
    }

    const relation = this.relations[relationName];

    if (!relation) {
      console.log('Relation ' + relationName + ' does not exist.')
      return results;
    }

    if (relation.type === 'belongsTo') {
      results = this.includeBelongsTo(results, relation, relationName, relationFilter);
    }

    if (relation.type === 'hasMany') {
      results = this.includeHasMany(results, relation, relationName, relationFilter);
    }

    return results;
  }

  async includer(results, include) {
    let isArray = true;
    if (!(results instanceof Array)) {
      isArray = false;
      results = [results];
    }

    if (include instanceof Array) {
      for (let i = 0; i < include.length; i++) {
        try {
          results = await this.includeByType(results, include[i]);
        }
        catch(err) {
          throw Bang.wrap(err);
        }
      }
    }
    else {
      results = this.includeByType(results, include);
    }

    if (!isArray) {
      results = results[0];
    }

    return results;
  }

  // Interface methods

  async count(where) {
    const countQuery = this.buildQuery('count', null, where);
    const { data: count, err } = await to(countQuery.exec());
    if (err) throw Bang.wrap(err);
    const response = { count: count };
    return Promise.resolve(response);
  }

  async find(filter) {
    const findQuery = this.buildQuery('find', filter);
    const { data: results, err } = await to(findQuery.lean().exec());
    if (err) throw Bang.wrap(err);
    let transformedResponse = this.transformResponse(results);
    if (filter && filter.include) {
      transformedResponse = this.includer(transformedResponse, filter.include);
    }
    return Promise.resolve(transformedResponse);
  }

  async findOne(filter) {
    const findQuery = this.buildQuery('findOne', filter);
    const { data: results, err } = await to(findQuery.lean().exec());
    if (err) throw Bang.wrap(err);
    let transformedResponse = this.transformResponse(results);
    if (filter && filter.include) {
      transformedResponse = this.includer(transformedResponse, filter.include);
    }
    return Promise.resolve(transformedResponse);
  }

  async findById(id, filter) {
    const findQuery = this.buildQuery('findById', filter, null, id);
    const { data: results, err } = await to(findQuery.lean().exec());
    if (err) throw Bang.wrap(err);
    let transformedResponse = this.transformResponse(results);
    if (filter && filter.include) {
      transformedResponse = this.includer(transformedResponse, filter.include);
    }
    return Promise.resolve(transformedResponse);
  }

  async create(modelOrModels) {
    const { data: newModelOrModels, err } = await to(this.model.create(modelOrModels));
    if (err) throw Bang.wrap(err);
    let transformedResponse;
    if (_.isArray(newModelOrModels)) {
      transformedResponse = newModelOrModels.map(model => this.transformResponse(model.toObject()));
    } else {
      transformedResponse = this.transformResponse(newModelOrModels.toObject());
    }
    return Promise.resolve(transformedResponse);
  }

  async destroyAll(where) {
    where = this.transformFilter(where);
    const { data: deleteResponse, err } = await to(this.model.deleteMany(where));
    if (err) throw Bang.wrap(err);
    const response = { count: deleteResponse.toJSON().n };
    return Promise.resolve(response);
  }

  async destroyById(id) {
    const { data: deleteResponse, err } = await to(this.model.findByIdAndRemove(id));
    if (err) throw Bang.wrap(err);
    const response = { count: 1 };
    return Promise.resolve(response);
  }

  async updateAll(where, params) {
    where = this.transformFilter(where);
    const { data: responseUpdate, err } = await to(this.model.updateMany(where, params));
    if (err) throw Bang.wrap(err);
    const response = { count: responseUpdate.n };
    return Promise.resolve(response);
  }

  async updateById(id, params) {
    const { data: responseUpdate, err } = await to(this.model.findByIdAndUpdate(id, params).exec());
    if (err) throw Bang.wrap(err);
    // TODO: Validar esto bien
    return Promise.resolve(params);
  }

}

module.exports = {
  createConnection: createConnection,
  model: MongodbModel
}
