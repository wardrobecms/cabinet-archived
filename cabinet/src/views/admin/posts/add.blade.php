@extends('cabinet::admin.layout')

@section('title')
	{{ Lang::get('cabinet::wardrobe.post_add') }}
@stop

@section('content')

{{ Form::open(array('method' => 'post', 'route' => array('wardrobe.post.store'))) }}

	{{ Form::text('title') }}
	{{ Form::text('slug') }}
	{{ Form::text('publish_date') }}

	{{ Form::textarea('content') }}

	{{ Form::select('active', array('1' => 'Yes', '0' => 'No')) }}

	{{ Form::submit('Save') }}

{{ Form::close() }}

@stop
