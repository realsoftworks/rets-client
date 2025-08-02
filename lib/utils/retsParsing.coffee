### jshint node:true ###
### jshint -W097 ###
'use strict'

sax = require('sax')
through2 = require('through2')

errors = require('./errors')
replyCodes = require('./replyCodes')
hex2a = require('./hex2a')
headersHelper = require('./headers')


# Parsing as performed here and in the other modules of this project relies on some simplifying assumptions.  DO NOT
# COPY OR MODIFY THIS LOGIC BLINDLY!  It works correctly for well-formed XML which adheres to the RETS specifications,
# and does not attempt to check for or properly handle XML not of that form.  In particular, it does not keep track of
# the element stack to ensure elements (and text) are found only in the expected locations.


# a parser with some basic common functionality, intended to be extended for real use
getSimpleParser = (retsContext, errCallback, parserEncoding='UTF-8') ->
  result =
    currElementName: null
    parser: sax.createStream(true, {trim: false, normalize: false})
    finish: () ->
      result.finished = true
      result.parser.removeAllListeners()
    status: null
    finished: false

  result.parser.once 'opentag', (node) ->
    if node.name != 'RETS'
      result.finish()
      errCallback(new errors.RetsProcessingError(retsContext, 'Unexpected results. Please check the RETS URL.'))

  result.parser.on 'opentag', (node) ->
    result.currElementName = node.name
    if node.name != 'RETS' && node.name != 'RETS-STATUS'
      return
    result.status =
      replyCode: node.attributes.ReplyCode
      replyTag: replyCodes.tagMap[node.attributes.ReplyCode]
      replyText: node.attributes.ReplyText
    if node.attributes.ReplyCode != '0' && node.attributes.ReplyCode != '20208'
      result.finish()
      errCallback(new errors.RetsReplyError(retsContext, node.attributes.ReplyCode, node.attributes.ReplyText))

  result.parser.on 'error', (err) ->
    result.finish()
    errCallback(new errors.RetsProcessingError(retsContext, "XML parsing error: #{errors.getErrorMessage(err)}"))

  result.parser.on 'end', () ->
    if !result.finished
      result.finish()
      errCallback(new errors.RetsProcessingError(retsContext, "Unexpected end of xml stream."))

  result


# parser that deals with column/data tags, as returned for metadata and search queries
getStreamParser = (retsContext, metadataTag, rawData, parserEncoding='UTF-8') ->
  if metadataTag
    rawData = false
    result =
      rowsReceived: 0
      entriesReceived: 0
  else
    result =
      rowsReceived: 0
      maxRowsExceeded: false
  delimiter = '\t'
  columnText = null
  dataText = null
  columns = null
  currElementName = null
  headers = null

  parser = sax.createStream(true, {trim: false, normalize: false})
  retsStream = through2.obj()
  finished = false
  finish = (type, payload) ->
    finished = true
    parser.removeAllListeners()
    # ignore errors after this point
    parser.on('error', () -> ### noop ###)
    retsStream.write(type: type, payload: payload)
    retsStream.end()
  errorHandler = (err) ->
    finish('error', err)
  writeOutput = (type, payload) ->
    retsStream.write(type: type, payload: payload)
  responseHandler = () ->
    writeOutput('headerInfo', retsContext.headerInfo)
  processStatus = (attrs) ->
    if attrs.ReplyCode != '0' && attrs.ReplyCode != '20208'
      return errorHandler(new errors.RetsReplyError(retsContext, attrs.ReplyCode, attrs.ReplyText))
    status =
      replyCode: attrs.ReplyCode
      replyTag: replyCodes.tagMap[attrs.ReplyCode]
      replyText: attrs.ReplyText
    writeOutput('status', status)

  parser.once 'opentag', (node) ->
    if node.name != 'RETS'
      return errorHandler(new errors.RetsProcessingError(retsContext, 'Unexpected results. Please check the RETS URL.'))
    processStatus(node.attributes)
    if !retsStream.writable
      # assume processStatus found a non-zero/20208 error code and ended the stream  So, we don't want to add the startElement listener.
      return
    parser.on 'opentag', (node) ->
      currElementName = node.name
      switch node.name
        when 'DATA'
          dataText = ''
        when 'COLUMNS'
          columnText = ''
        when metadataTag
          writeOutput('metadataStart', node.attributes)
          result.rowsReceived = 0
        when 'COUNT'
          ### Ignore count write when stream ended due to NO_RECORDS_FOUND (20201) error. ###
          if !retsStream.writable && parseInt(node.attributes.Records) == 0
            return false
          writeOutput('count', parseInt(node.attributes.Records))
        when 'MAXROWS'
          result.maxRowsExceeded = true
        when 'DELIMITER'
          delimiter = hex2a(node.attributes.value)
          writeOutput('delimiter', delimiter)
        when 'RETS-STATUS'
          processStatus(node.attributes)

  parser.on 'text', (text) ->
    switch currElementName
      when 'DATA'
        dataText += text
      when 'COLUMNS'
        columnText += text

  if rawData
    parser.on 'closetag', (name) ->
      currElementName = null
      switch name
        when 'DATA'
          writeOutput('data', dataText)
          result.rowsReceived++
        when 'COLUMNS'
          writeOutput('columns', columnText)
        when 'RETS'
          finish('done', result)
  else
    parser.on 'closetag', (name) ->
      currElementName = null
      switch name
        when 'DATA'
          if !columns
            return errorHandler(new errors.RetsProcessingError(retsContext, 'Failed to parse columns'))
          data = dataText.split(delimiter)
          model = {}
          i=1
          while i < columns.length-1
            model[columns[i]] = data[i]
            i++
          writeOutput('data', model)
          result.rowsReceived++
        when 'COLUMNS'
          if !delimiter
            return errorHandler(new errors.RetsProcessingError(retsContext, 'Failed to parse delimiter'))
          columns = columnText.split(delimiter)
          writeOutput('columns', columns)
        when metadataTag
          result.entriesReceived++
          writeOutput('metadataEnd', result.rowsReceived)
        when 'RETS'
          if metadataTag
            delete result.rowsReceived
          finish('done', result)

  parser.on 'error', (err) ->
    errorHandler(new errors.RetsProcessingError(retsContext, "XML parsing error: #{errors.getErrorMessage(err)}"))
  
  parser.on 'end', () ->
    # we remove event listeners upon success, so getting here implies failure
    # but sax fires end event normally, so check if we haven't finished yet
    if !finished
      errorHandler(new errors.RetsProcessingError(retsContext, "Unexpected end of xml stream."))

  retsContext.parser = parser
  retsContext.errorHandler = errorHandler
  retsContext.responseHandler = responseHandler
  retsContext.retsStream = retsStream
  retsContext
  
  
module.exports =
  getSimpleParser: getSimpleParser
  getStreamParser: getStreamParser
