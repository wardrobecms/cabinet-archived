@extends('cabinet::admin.layout')

@section('title')
	Admin
@stop

@section('content')
	<div id="main-region"></div>
@stop

@section('footer.js')
<script type="text/javascript">
	$(document).ready(function() {
		Wardrobe.start({
			user: {{ $user }},
			users: {{ $users }},
			posts: {{ $posts }},
			api_url: "{{ route('wardrobe.api.index') }}",
			admin_url: "{{ route('wardrobe.admin.index') }}",
			blog_url: "/",
			editor: "{{ Config::get('wardrobe.editor', 'lepture') }}"
		});
	});
	window.Lang = {@foreach($locale as $key => $item) {{ $key }}: "{{ $item }}", @endforeach}
</script>
@stop
