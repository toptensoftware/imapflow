'use strict';

const { getStatusCode, getErrorText } = require('../tools.js');
const { searchCompiler } = require('../search-compiler.js');

// Updates flags for a message
module.exports = async (connection, order, query, options) => {
    if (connection.state !== connection.states.SELECTED) {
        // nothing to do here
        return false;
    }

    options = options || {};

    let orderAttributes = [];

    if (!Array.isArray(order))
        order = [ order ];
    for (let o of order)
    {
        if (o.startsWith('-'))
        {
            orderAttributes.push({ type: 'ATOM', value: "REVERSE" });
            o = o.substring(1);
        }
        orderAttributes.push({ type: 'ATOM', value: o });
    }
    

    let attributes = [];

    attributes.push(orderAttributes);
    attributes.push({ type: 'ATOM', value: 'UTF-8' });

    if (!query || query === true || (typeof query === 'object' && (!Object.keys(query).length || (Object.keys(query).length === 1 && query.all)))) {
        // search for all messages
        attributes.push({ type: 'ATOM', value: 'ALL' });
    } else if (query && typeof query === 'object') {
        // normal query
        attributes.push(...searchCompiler(connection, query));
    } else {
        return false;
    }

    let results = [];
    let response;
    try {
        response = await connection.exec(options.uid ? 'UID SORT' : 'SORT', attributes, {
            untagged: {
                SORT: async untagged => {
                    if (untagged && untagged.attributes && untagged.attributes.length) {
                        untagged.attributes.forEach(attribute => {
                            if (attribute && attribute.value && typeof attribute.value === 'string' && !isNaN(attribute.value)) {
                                results.push(Number(attribute.value));
                            }
                        });
                    }
                }
            }
        });
        response.next();
        return results;
    } catch (err) {
        let errorCode = getStatusCode(err.response);
        if (errorCode) {
            err.serverResponseCode = errorCode;
        }
        err.response = await getErrorText(err.response);

        connection.log.warn({ err, cid: connection.id });
        return false;
    }

}

